# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Antigravity is a man-in-the-middle TLS proxy that sits between the Antigravity AI desktop app (which speaks Google Gemini API format) and LLM providers (OpenAI-compatible, Anthropic, Google). It intercepts Gemini-format requests on port 443, translates them to the target provider's API format, and streams the response back — making Antigravity work with any LLM.

## Build & Test Commands

All commands run from the `proxy/` directory:

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run typecheck    # type-check only (no emit)
npm test             # run tests (tsx test/run.ts)
npm run dev          # watch mode (tsx watch src/index.ts)
npm start            # run compiled output
npm run start:prod   # run from dist/index.js
npm run gen-certs    # generate self-signed TLS certs (certs/cert.pem, certs/key.pem)
```

CI runs on Ubuntu, macOS, Windows × Node 20/22/24. It runs typecheck, tests, build, and cert generation in sequence.

## Architecture

### Core Pipeline

```
Antigravity App → [port 443 TLS] → Proxy → [API call] → LLM Provider
                                    ↓
                            Dashboard [port 4000]
```

1. **TLS Intercept** (`proxy/src/index.ts`) — HTTPS server on port 443 captures Gemini-format requests
2. **Context Stripping** — removes `<skills>/<plugins>/<user_rules>/<identity>` (~3500–5000 tokens saved per request), injects compact `agent-context.md` reference
3. **Format Mapping** (`proxy/src/mapper.ts`) — converts Google Gemini request format → OpenAI-compatible format
4. **Routing** (`proxy/src/router.ts`) — failover orchestrator: tries model-specific providers first, then global fallback. Exponential backoff, max 2 retries per provider.
5. **Adapters** (`proxy/src/adapter.ts`) — three implementations:
   - `OpenAICompatAdapter` — OpenAI, NVIDIA, OpenRouter, Groq, Zen, local (Ollama/vLLM/LM Studio)
   - `AnthropicAdapter` — Anthropic Messages API
   - `GoogleAdapter` — Google Gemini API
6. **Response Rewrap** — streaming response re-wrapped into Google SSE format back to Antigravity

### Key Design Decisions

- **Format translation is the core value**: Antigravity hardcodes the Google Gemini API. The proxy translates to any provider's format.
- **`agent-context.md`** is the proxy's system prompt injection. It documents all of Antigravity's internal tools (`run_command`, `write_to_file`, `manage_task`, `manage_subagents`, etc.) with correct schemas so non-Gemini models can use them. This file is injected into every request.
- **Context strip mode** (`CONTEXT_STRIP_MODE` env var): `strip` (default) removes Antigravity's bulk context tags; `passthrough` forwards everything. Controlled from the dashboard Config tab.
- **Workspace context hardening** (`proxy/src/workspace-context.ts`): anti-hallucination envelope system with `off`/`loose`/`strict` modes. Anonymizes file paths, wraps system instructions to prevent LLM confusion between documentation and runtime state.

### Configuration

- **Hot-reloadable**: Config, models, pricing, blocklist, and reasoning effort reload without restart
- **Singleton config** (`proxy/src/config.ts`): loaded from `.env` via dotenv, supports all provider API keys, priority, ports, rate limits, dashboard auth
- **Model resolver** (`proxy/src/models.ts` + `proxy/models.json`): per-provider overrides and flat default map for model name translation
- **SQLite** (`proxy/src/db.ts`): WAL mode, stores sessions, requests, logs for cost tracking and history

### Dashboard

SPA served on port 4000. Tabs: Stats, Requests, Sessions, Cost, Models, Model Options, Config. Features SSE log streaming, config editor, cost charts (Chart.js), full-text search, session compare, request replay.

## Working With This Codebase

- The proxy directory contains all source code. The root is primarily docs and repo config.
- TypeScript with ESM (`import.meta.url`). Uses `tsx` for dev, `tsc` for build.
- `provider-cache.ts` provides 10-min TTL caching for provider model lists. Cache endpoints: GET/POST/DELETE `/api/provider-models`.
- `reasoning-effort.ts` persists per-model effort levels to `reasoning-effort.json`. Auto-detects reasoning models from model names.
- `local-discovery.ts` auto-detects Ollama/vLLM/LM Studio on startup.
- `http-pool.ts` handles connection pooling; `rate-limiter.ts` provides global + per-provider rate limiting.
- When adding new providers or models, check `proxy/models.json` for the model alias map and `_provider_models` for per-provider overrides.
