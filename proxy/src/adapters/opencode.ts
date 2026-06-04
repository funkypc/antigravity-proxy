import crypto from 'crypto';
import type { OpenAIMessage } from '../mapper.js';
import type { StreamChunk, ModelAdapter } from './types.js';
import { poolFetch } from '../http-pool.js';
import { logger } from '../logger.js';

const OC_VERSION = '1.15.13';
let cachedModels: string[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function ocId(prefix: string): string {
  const ts = Date.now().toString(16);
  const rnd = crypto.randomBytes(12).toString('base64url').slice(0, 16);
  return `${prefix}_${ts}${rnd}`;
}

const userSessions = new Map<string, { id: string; ts: number }>();
function getSession(): string {
  const now = Date.now();
  const key = 'default';
  if (!userSessions.has(key) || now - userSessions.get(key)!.ts > 30 * 60 * 1000) {
    userSessions.set(key, { id: ocId('ses'), ts: now });
  }
  return userSessions.get(key)!.id;
}

const reasoningCache = new Map<string, string>();

function msgKey(msg: any): string {
  const m: any = {};
  if (msg.content) m.content = msg.content;
  if (msg.tool_calls?.length) {
    m.tool_calls = msg.tool_calls.map((tc: any) => ({
      type: tc.type || 'function',
      function: {
        name: tc.function?.name ?? '',
        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? ''),
      },
    }));
  }
  return crypto.createHash('sha256').update(JSON.stringify(m, Object.keys(m).sort())).digest('hex');
}

export class OpenCodeAdapter implements ModelAdapter {
  provider = 'opencode';
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl || 'https://opencode.ai/zen/go/v1').replace(/\/+$/, '');
    this.apiKey = apiKey || 'public';
  }

  async *stream(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const sessionId = getSession();
    const requestId = ocId('msg');

    // Restore cached reasoning_content for assistant tool-call messages, else set empty string
    const patchedMessages = messages.map((m: any) => {
      if (m?.role === 'assistant' && m?.tool_calls?.length && !m.reasoning_content) {
        const cached = reasoningCache.get(msgKey(m));
        return { ...m, reasoning_content: cached ?? '' };
      }
      return m;
    });

    const body: Record<string, unknown> = { model, messages: patchedMessages, stream: true };
    if (tools && Object.keys(tools).length > 0) {
      body.tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
        type: 'function',
        function: { name, description: tool.description || '', parameters: tool.parameters || {} },
      }));
    }

    const response = await this.zenFetch(body, sessionId, requestId, signal);

    if (!this.isStreaming(response)) {
      const data = await response.json() as any;
      if (data.error) throw new Error(data.error.message || 'opencode error');
      const choice = data.choices?.[0];
      if (choice?.message?.reasoning_content) {
        yield { type: 'thought', content: choice.message.reasoning_content };
        reasoningCache.set(msgKey(choice.message), choice.message.reasoning_content);
      }
      if (choice?.message?.content) yield { type: 'text', content: choice.message.content };
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          yield { type: 'tool-call', name: tc.function.name, args: this.parseToolArgs(tc.function.arguments) };
        }
      }
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let accumulatedReasoning = '';
    const toolCallBuffers = new Map<number, { id?: string; name?: string; arguments: string }>();

    let lastToolCalls: any[] | undefined;

    try {
      let doneFlag = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') { doneFlag = true; break; }
          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }

          if (chunk.error) throw new Error(chunk.error.message || 'opencode error');
          if (chunk.type === 'error') throw new Error(chunk.message || 'opencode error');

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.reasoning_content) {
            accumulatedReasoning += delta.reasoning_content;
            yield { type: 'thought', content: delta.reasoning_content };
          }
          if (delta.content) {
            accumulatedContent += delta.content;
            yield { type: 'text', content: delta.content };
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffers.has(idx)) toolCallBuffers.set(idx, { arguments: '' });
              const buf = toolCallBuffers.get(idx)!;
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason === 'tool_calls') {
            lastToolCalls = [...toolCallBuffers.values()].map(buf => ({
              type: 'function',
              function: { name: buf.name || '', arguments: buf.arguments },
            }));
            for (const [, buf] of toolCallBuffers) {
              yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
            }
            toolCallBuffers.clear();
          }
        }
        if (doneFlag) break;
      }
      if (toolCallBuffers.size > 0) {
        for (const [, buf] of toolCallBuffers) {
          yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
        }
      }
    } finally {
      if (accumulatedReasoning) {
        const tcs = lastToolCalls ?? (toolCallBuffers.size ? [...toolCallBuffers.values()].map(buf => ({
          type: 'function',
          function: { name: buf.name || '', arguments: buf.arguments },
        })) : undefined);
        reasoningCache.set(msgKey({ content: accumulatedContent, ...(tcs?.length ? { tool_calls: tcs } : {}) }), accumulatedReasoning);
      }
      reader.releaseLock();
    }
  }

  private async zenFetch(
    body: Record<string, unknown>,
    sessionId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await poolFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': `opencode/${OC_VERSION} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`,
        'x-opencode-client': 'cli',
        'x-opencode-project': 'global',
        'x-opencode-request': requestId,
        'x-opencode-session': sessionId,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      if (response.status === 429) {
        throw new Error(`[opencode] Rate limited: ${err}`);
      }
      throw new Error(`[opencode] API error ${response.status}: ${err}`);
    }
    return response;
  }

  private isStreaming(res: Response): boolean {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
  }

  private parseToolArgs(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return {}; }
  }

  static async fetchModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
    const now = Date.now();
    if (cachedModels && now - cacheTime < CACHE_TTL) return cachedModels;
    const url = ((baseUrl || 'https://opencode.ai/zen/go/v1').replace(/\/+$/, '')) + '/models';
    try {
      const res = await poolFetch(url, { headers: { 'Authorization': `Bearer ${apiKey || 'public'}` } });
      if (res.ok) {
        const data = await res.json() as any;
        cachedModels = (data.data || []).map((m: any) => m.id);
        cacheTime = now;
        return cachedModels!;
      }
    } catch {}
    cachedModels = ['glm-5.1', 'glm-5', 'kimi-k2.6', 'kimi-k2.5', 'deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus'];
    cacheTime = now;
    return cachedModels;
  }

  static getModels(): string[] {
    return cachedModels || ['glm-5.1', 'glm-5', 'kimi-k2.6', 'kimi-k2.5', 'deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus'];
  }
}
