# Antigravity Proxy — Full Implementation Plan

> **Goal:** Fix all bugs, broken features, partial implementations, and polish issues
> from two deep codebase analysis passes. Ordered by severity. Each fix includes
> file locations, root cause, fix description, and test criteria.

---

## WAVE DEPENDENCY MAP

```
WAVE 0 (Foundation)     ──────────────────────────────┐
  #4 TTLMap utility                                    │
  #24 Logger cleanup                                   │
  #22 DB noop stub                                     │
                                                      ▼
WAVE 1 (Critical Fixes) ──────────────────────────────┐
  #1  Config default flip          (needs #4)          │
  #2  Router system param loss     (independent)       │
  #3  injectReasoning false-positive (independent)     │
  #5  Request body size limit      (independent)       │
                                                      ▼
WAVE 2 (Memory & Safety) ─────────────────────────────┐
  #4a Reasoning store TTL          (needs #4)          │
  #4b Session store TTL            (needs #4)          │
  #4c Agent context cache TTL      (needs #4)          │
  #18 Timing-safe auth             (independent)       │
  #17 Port 443 fallback            (independent)       │
  #12 DNS failure graceful         (independent)       │
                                                      ▼
WAVE 3 (Reliability)    ──────────────────────────────┐
  #6  Rate limiter mutex           (independent)       │
  #7  Blocklist hot-reload         (independent)       │
  #8  writeEnv regex escape        (independent)       │
  #9  Stale cache invalidation     (independent)       │
                                                      ▼
WAVE 4 (Adapter Fixes)  ──────────────────────────────┐
  #10 Anthropic system field       (independent)       │
  #11 Google system instruction    (independent)       │
  #16 normalizeToolArgs call       (independent)       │
  #15 Tool call ID uniqueness      (independent)       │
                                                      ▼
WAVE 5 (Consolidation)  ──────────────────────────────┐
  #14 Adapter deduplication        (needs #10,#11)     │
  #13 SSE memory leak              (independent)       │
                                                      ▼
WAVE 6 (Polish)         ──────────────────────────────┐
  #19 CORS on all responses        (independent)       │
  #20 HTTP/2 upstream              (independent)       │
  #21 Config reload preservation   (needs #1,#7)       │
  #23 Request count persistence    (needs #22)         │
  #25 Configurable strip tags      (independent)       │
  #26 Graceful shutdown            (independent)       │
                                                      ▼
                              ALL DONE ✓
```

---

## WAVE 0 — FOUNDATION (No dependencies, do first)

These are pure utilities/stubs needed by later waves. All 3 are independent of each other.

---

### Fix #4: TTLMap Utility (NEW FILE)

**File:** `proxy/src/ttl-map.ts` (new)
**Depends on:** nothing
**Blocks:** #1 (config), #4a/#4b/#4c (memory leaks)

**Problem:** Three unbounded `Map` objects in the codebase (`reasoningStore`, `sessionStore`, agent context cache) grow forever — memory leaks.

**Fix:**
```typescript
// proxy/src/ttl-map.ts
export class TTLMap<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) { ... }
  get(key: K): V | undefined { ... }       // lazy eviction on access
  set(key: K, value: V): void { ... }      // evict oldest if over max
  has(key: K): boolean { ... }
  delete(key: K): boolean { ... }
  get size(): number { ... }
  prune(): void { ... }                     // remove all expired entries
}
```

**Test:** `proxy/test/ttl-map.test.ts`
- Insert 11,000 entries into a `TTLMap(10000, 60000)` → size stays ≤ 10000
- Insert entry, wait TTL, `get()` returns `undefined`
- `prune()` removes expired entries
- `get()` on expired entry returns `undefined` and evicts

---

### Fix #24: Logger Cleanup

**File:** `proxy/src/logger.ts`
**Depends on:** nothing
**Blocks:** nothing (standalone cleanup)

**Problem:** Production code uses `console.log/warn/error`. AGENTS.md forbids this.

**Fix:**
- Replace all `console.log()` → `logger.info()`
- Replace all `console.warn()` → `logger.warn()`
- Replace all `console.error()` → `logger.error()`
- Keep `console` only for the log destination (file/stderr writes)

**Test:** `npx tsx test/run.ts dead-code` — grep for `console.log` in src/ returns 0 hits

---

### Fix #22: DB Noop Stub

**File:** `proxy/src/db.ts` line 25
**Depends on:** nothing
**Blocks:** #23 (request count persistence)

**Problem:** `run: () => ({})` returns `{}` but callers expect `{ changes, lastInsertRowid }`.

**Fix:**
```typescript
run: () => ({ changes: 0, lastInsertRowid: 0 })
```

**Test:** Import `db` module, call `run()`, assert `result.changes === 0` and `result.lastInsertRowid === 0`

---

## WAVE 1 — CRITICAL FIXES (System breaks → must fix first)

All 4 fixes are independent of each other. Can be done in parallel by different agents.

---

### Fix #1: Config `contextStripMode` Default Flip

**File:** `proxy/src/config.ts` lines ~76 and ~128
**Depends on:** #4 (TTLMap — not directly, but needs utility pattern for defaults map)
**Blocks:** #21 (config reload preservation)

**Problem:** Initial load defaults `contextStripMode` to `'passthrough'` (line ~76). After `.env` reload, it defaults to `'strip'` (line ~128). User's setting silently changes.

**Root cause:** Two separate default objects — `defaults` map vs inline fallback in `coerce()`.

**Fix:**
1. Add `CONTEXT_STRIP_MODE: 'passthrough'` to the `defaults` map
2. Remove the hardcoded `'strip'` fallback in the coerce/reload path
3. Both initial load and reload use the same `defaults` object
4. Add JSDoc: "All default values must live in the `defaults` map"

**Test:** `proxy/test/config-reload.test.ts`
- Set `CONTEXT_STRIP_MODE=passthrough` in initial config
- Reload config (with `.env` not mentioning it)
- Assert `config.contextStripMode` still equals `'passthrough'`
- Repeat with `'strip'` — same behavior

---

### Fix #2: Router First-Pass Drops `system` Parameter

**File:** `proxy/src/router.ts` lines ~117 vs ~195
**Depends on:** nothing
**Blocks:** nothing

**Problem:** The primary `for` loop calls `adapter.stream()` without passing `system`. The fallback `for` loop (line ~195) passes `system`. System prompts silently lost for primary providers.

**Fix:**
1. In the primary loop, pass `system` to `adapter.stream()`:
   ```typescript
   // Before (broken):
   const result = await adapter.stream(model, messages, undefined, userOptions);
   // After (fixed):
   const result = await adapter.stream(model, messages, system, userOptions);
   ```
2. Verify the same `system` variable is in scope (it is — extracted earlier from messages)

**Test:** `proxy/test/router-system-prompt.test.ts`
- Create a mock adapter that records what args it receives
- Route a request with system + user messages
- Assert mock adapter received the `system` parameter on first call

---

### Fix #3: `injectReasoning()` False-Positive Logic

**File:** `proxy/src/engine.ts` lines ~27-37
**Depends on:** nothing
**Blocks:** nothing

**Problem:** When no `reasoningStore` exists, the function copies `content` → `reasoning_content` for every assistant message. This is wrong — reasoning should only appear when the model actually produced reasoning.

**Fix:**
```typescript
// Before (broken):
function injectReasoning(messages: OpenAIMessage[]): OpenAIMessage[] {
  return messages.map(m => {
    if (m.role === 'assistant' && m.content) {
      return { ...m, reasoning_content: m.reasoning_content || m.content };
    }
    return m;
  });
}

// After (fixed):
function injectReasoning(messages: OpenAIMessage[]): OpenAIMessage[] {
  if (!reasoningStore) return messages;  // no reasoning available, skip
  return messages.map(m => {
    if (m.role === 'assistant' && m.id) {
      const reasoning = reasoningStore.get(m.id);
      if (reasoning) {
        return { ...m, reasoning_content: reasoning };
      }
    }
    return m;
  });
}
```

**Test:** `proxy/test/engine-reasoning.test.ts`
- Message without reasoning store entry → `reasoning_content` remains `undefined`
- Message with reasoning store entry → `reasoning_content` is populated
- No reasoning store at all → messages pass through unchanged

---

### Fix #5: No Request Body Size Limit (DoS Vector)

**File:** `proxy/src/index.ts` lines ~673-678
**Depends on:** nothing
**Blocks:** nothing

**Problem:** Full request body buffered with no max size. A 10GB POST exhausts memory.

**Fix:**
1. Read `MAX_BODY_BYTES` from config, default `10 * 1024 * 1024` (10MB)
2. Track accumulated size during chunk collection
3. If exceeded, destroy socket and return 413:
   ```typescript
   const maxBytes = parseInt(process.env.MAX_BODY_BYTES || '10485760');
   let totalBytes = 0;
   req.on('data', (chunk: Buffer) => {
     totalBytes += chunk.length;
     if (totalBytes > maxBytes) {
       req.destroy();
       resp.writeHead(413, { 'Content-Type': 'application/json' });
       resp.end(JSON.stringify({ error: `Payload too large. Max: ${maxBytes} bytes` }));
       return;
     }
     chunks.push(chunk);
   });
   ```

**Test:** `proxy/test/body-limit.test.ts`
- Send 1KB body → 200 OK
- Send 11MB body (with `MAX_BODY_BYTES=10485760`) → 413 Payload Too Large
- Verify proxy memory doesn't spike on large body

---

## WAVE 2 — MEMORY & SAFETY (All independent, parallel after Wave 0)

All 6 fixes are independent of each other.

---

### Fix #4a: Reasoning Store TTL

**File:** `proxy/src/engine.ts` line 20
**Depends on:** #4 (TTLMap)
**Blocks:** nothing

**Problem:** `reasoningStore` is an unbounded `Map<string, string>`. Over long sessions, it grows without limit.

**Fix:**
```typescript
// Before:
const reasoningStore = new Map<string, string>();

// After:
const reasoningStore = new TTLMap<string, string>(10000, 30 * 60 * 1000); // 10k entries, 30min TTL
```

**Test:** Insert 11,000 entries → size stays ≤ 10,000. Insert entry, wait 30min (mock timer) → evicted.

---

### Fix #4b: Session Store TTL

**File:** `proxy/src/auth-sessions.ts` line ~20
**Depends on:** #4 (TTLMap)
**Blocks:** nothing

**Problem:** `sessionStore` is an unbounded `Map<string, AuthSession>`. Never evicted.

**Fix:**
```typescript
// Before:
const sessionStore = new Map<string, AuthSession>();

// After:
const sessionStore = new TTLMap<string, AuthSession>(1000, 60 * 60 * 1000); // 1k sessions, 1hr TTL
```

**Test:** Insert 1,001 sessions → oldest evicted. Insert session, wait 1hr → `get()` returns `undefined`.

---

### Fix #4c: Agent Context Cache TTL

**File:** `proxy/src/index.ts` lines 62-75
**Depends on:** #4 (TTLMap)
**Blocks:** #9 (stale cache — this partially addresses it)

**Problem:** `_agentContextContent` cached once on first request, never expires.

**Fix:**
```typescript
const agentContextCache = new TTLMap<string, string>(1, 5 * 60 * 1000); // 1 entry, 5min TTL
```

**Test:** First request → cache miss, reads file. Second request within 5min → cache hit. Third request after 5min → cache miss, re-reads.

---

### Fix #18: Timing-Safe Auth Length Leak

**File:** `proxy/src/auth-sessions.ts` lines ~15-18
**Depends on:** nothing
**Blocks:** nothing

**Problem:** `timingSafeEqual` returns `false` on different lengths, leaking length info via timing.

**Fix:**
```typescript
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.alloc(bufA.length, 0);
  b.copy(bufB, 0, 0, bufA.length);
  return crypto.timingSafeEqual(bufA, bufB);
}
```
Or simpler: pad shorter string to match longer string's length before comparing.

**Test:** Compare "abc" vs "ab" → false, no timing difference measurable.

---

### Fix #17: Port 443 Graceful Fallback

**File:** `proxy/src/index.ts`
**Depends on:** nothing
**Blocks:** nothing

**Problem:** Port 443 fails silently when not admin — user sees no error message.

**Fix:**
1. Catch `EACCES` on port 443
2. Log: `"Port 443 requires admin/root. Falling back to port 8443. Use --port or PROXY_PORT to set custom port."`
3. Retry with port 8443
4. If 8443 also fails, log error and exit

**Test:** Mock server `listen()` to throw `EACCES` → verify fallback to 8443 attempted, warning logged.

---

### Fix #12: DNS Failure Graceful Degradation

**File:** `proxy/src/index.ts` lines ~724-730
**Depends on:** nothing
**Blocks:** nothing

**Problem:** If `cloudcode-pa.googleapis.com` unresolvable, entire proxy dies with `process.exit(1)`.

**Fix:**
1. Make DNS check non-fatal:
   ```typescript
   let dnsOk = true;
   try {
     await dns.lookup('cloudcode-pa.googleapis.com');
   } catch {
     dnsOk = false;
     logger.warn('DNS resolution failed for cloudcode-pa.googleapis.com — proxy will run in degraded mode');
   }
   // Do NOT call process.exit(1)
   ```
2. Health endpoint reports DNS status: `{ status: dnsOk ? 'ok' : 'degraded', dns: dnsOk }`
3. On actual forward, if DNS fails, return 502 with clear error message

**Test:** Mock DNS failure → proxy still starts. Health endpoint shows `degraded`. Forward request returns 502.

---

## WAVE 3 — RELIABILITY (All independent, parallel after Wave 0)

All 4 fixes are independent of each other.

---

### Fix #6: Rate Limiter Race Condition

**File:** `proxy/src/rate-limiter.ts`
**Depends on:** nothing
**Blocks:** nothing

**Problem:** `prune()` and `isAllowed()` can run concurrently — concurrent map mutation.

**Fix:**
1. Add async mutex:
   ```typescript
   let lock = Promise.resolve();
   async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
     const prev = lock;
     let resolve!: () => void;
     lock = new Promise(r => resolve = r);
     await prev;
     try { return await fn(); }
     finally { resolve(); }
   }
   ```
2. Wrap `isAllowed()` and `prune()` in `withLock()`

**Test:** Fire 100 concurrent `isAllowed()` calls → final count matches expected (no race).

---

### Fix #7: Blocklist Hot-Reload

**File:** `proxy/src/blocklist.ts`, `proxy/src/config.ts`
**Depends on:** nothing
**Blocks:** #21

**Problem:** `reload()` exists on blocklist but `config.reload()` never calls it. Blocked IPs stay blocked until restart.

**Fix:**
1. In `config.reload()`, after parsing new blocklist from `.env`:
   ```typescript
   const newBlocklist = parseBlocklist(process.env.BLOCKLIST_IPS || '');
   blocklist.reload(newBlocklist);
   ```
2. Export `blocklist` instance from its module

**Test:** Add IP to `.env`, reload config, verify new IP is blocked. Remove IP, reload, verify unblocked.

---

### Fix #8: Dashboard `writeEnv()` Regex Escape

**File:** `proxy/src/dashboard.ts` line ~212
**Depends on:** nothing
**Blocks:** nothing

**Problem:** `new RegExp('^${k}=.*', 'm')` — keys with regex metacharacters break or allow injection.

**Fix:**
```typescript
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// In writeEnv:
const pattern = new RegExp(`^${escapeRegex(k)}=.*`, 'm');
```

**Test:** API key with `.` in name → regex matches correctly. API key with `+` → matches correctly.

---

### Fix #9: Stale Cache Invalidation (Agent Context)

**File:** `proxy/src/index.ts` lines 62-75
**Depends on:** #4c (TTLMap — partially addresses)
**Blocks:** nothing

**Problem:** `_agentContextContent` cached once, never refreshed when file changes.

**Fix:**
1. Store `mtimeMs` alongside cached content
2. On each request, `fs.stat()` the file; if mtime changed, re-read and update
3. Debounce: only stat once per 5 seconds max
4. Better approach: use `fs.watchFile` (not `fs.watch`) with 5s interval

```typescript
let agentContextMtime = 0;
let agentContextContent = '';
let lastStatCheck = 0;

async function getAgentContext(): Promise<string> {
  const now = Date.now();
  if (now - lastStatCheck < 5000 && agentContextContent) {
    return agentContextContent;
  }
  lastStatCheck = now;
  try {
    const stat = await fs.stat(AGENT_CONTEXT_PATH);
    if (stat.mtimeMs !== agentContextMtime) {
      agentContextContent = await fs.readFile(AGENT_CONTEXT_PATH, 'utf-8');
      agentContextMtime = stat.mtimeMs;
    }
  } catch { /* file missing, use cached */ }
  return agentContextContent;
}
```

**Test:** Modify `agent-context.md`, next request gets fresh content within 5s.

---

## WAVE 4 — ADAPTER FIXES (All independent, parallel)

All 4 fixes are independent of each other.

---

### Fix #10: Anthropic Adapter System Field

**File:** `proxy/src/adapters/anthropic.ts` lines ~25-27
**Depends on:** nothing
**Blocks:** #14 (adapter consolidation)

**Problem:** Prepends system as a user message, but Anthropic API uses a dedicated `system` field.

**Fix:**
```typescript
// Before (broken):
const messages = [{ role: 'user', content: system }, ...rest];

// After (fixed):
const request = {
  model: modelId,
  max_tokens: maxTokens,
  system: system,  // dedicated field
  messages: messages.filter(m => m.role !== 'system'),  // no system in messages
  stream: true,
};
```

**Test:** Message array with system → API request has `system` field, messages don't include it. System content is preserved exactly.

---

### Fix #11: Google Adapter System Instruction

**File:** `proxy/src/adapters/google.ts`
**Depends on:** nothing
**Blocks:** #14 (adapter consolidation)

**Problem:** System included as first message AND potentially in `systemInstruction`, causing duplication.

**Fix:**
1. Extract system messages from conversation
2. Place ONLY in `systemInstruction` field
3. Never duplicate in `contents` array

```typescript
const systemInstruction = messages
  .filter(m => m.role === 'system')
  .map(m => m.content)
  .join('\n\n');

const contents = messages
  .filter(m => m.role !== 'system')
  .map(m => ({ role: m.role, parts: [{ text: m.content }] }));

const request = {
  contents,
  systemInstruction: { parts: [{ text: systemInstruction }] },
  generationConfig: { ... },
};
```

**Test:** System + 2 user messages → `systemInstruction` has system, `contents` has only 2 messages. No duplication.

---

### Fix #16: `normalizeToolArgs()` Never Called

**Files:** `proxy/src/tool-normalizer.ts`, `proxy/src/engine.ts`
**Depends on:** nothing
**Blocks:** nothing

**Problem:** AGENTS.md lists tool normalizer as available, but engine never imports/calls it.

**Fix:**
1. Import `normalizeToolArgs` in `engine.ts`
2. Call it on incoming tool calls before forwarding to adapter:
   ```typescript
   import { normalizeToolArgs } from './tool-normalizer.js';
   // In request handler, before adapter.stream():
   if (body.tools) {
     body.tools = body.tools.map(t => ({
       ...t,
       function: {
         ...t.function,
         parameters: normalizeToolArgs(t.function.parameters),
       },
     }));
   }
   ```

**Test:** Malformed tool args (missing required params, wrong types) → normalized correctly before forwarding.

---

### Fix #15: Tool Call ID Uniqueness

**File:** `proxy/src/mapper.ts` lines ~47-52
**Depends on:** nothing
**Blocks:** nothing

**Problem:** `callIndex` resets per request — safe currently but fragile if requests share state in future.

**Fix:**
```typescript
// Before:
const callId = `call_${callIndex++}`;

// After:
const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${callIndex++}`;
```

Or use a global monotonic counter instead of per-request.

**Test:** 100 rapid requests → no duplicate tool call IDs across requests.

---

## WAVE 5 — CONSOLIDATION (After adapter fixes)

---

### Fix #14: Adapter Deduplication

**Files:** `proxy/src/adapters/nvidia.ts`, `zen.ts`, `opencode-go.ts`
**Depends on:** #10, #11 (adapter system field fixes must be done first)
**Blocks:** nothing

**Problem:** Near-identical to `openai.ts` — only endpoint URL differs.

**Fix:**
1. Refactor `OpenAICompatAdapter` to accept endpoint URL as constructor param
2. Replace each adapter with a factory:
   ```typescript
   // builtin-plugins.ts
   export const nvidiaPlugin: IProviderPlugin = {
     id: 'nvidia',
     createAdapter: (config) => new OpenAICompatAdapter(config, {
       endpoint: 'https://integrate.api.nvidia.com/v1',
     }),
   };
   ```
3. Delete `nvidia.ts`, `zen.ts`, `opencode-go.ts`
4. Update `builtin-plugins.ts` to use factory pattern

**Test:** All existing adapter tests pass. NVIDIA/Zen/OpenCodeGo requests route correctly.

---

### Fix #13: Dashboard SSE Memory Leak

**File:** `proxy/src/dashboard.ts`
**Depends on:** nothing
**Blocks:** nothing

**Problem:** EventSource streams never cleaned up when client disconnects.

**Fix:**
```typescript
// On every SSE connection:
req.on('close', () => {
  const idx = handlers.indexOf(handler);
  if (idx !== -1) handlers.splice(idx, 1);
});
```

**Test:** Connect SSE, disconnect, verify handler removed from array. Reconnect → new handler added.

---

## WAVE 6 — POLISH (All independent, parallel, lowest priority)

All 7 fixes are independent of each other.

---

### Fix #19: CORS on All Responses

**File:** `proxy/src/index.ts`
**Depends on:** nothing
**Fix:** Add `access-control-allow-origin: *` to every response, not just `jsonResp()`.

### Fix #20: HTTP/2 Upstream

**File:** `proxy/src/index.ts`
**Depends on:** nothing
**Fix:** Consider `http2.request` for upstream calls, or document HTTP/1.1 tradeoff.

### Fix #21: Config Reload Preservation

**File:** `proxy/src/config.ts`
**Depends on:** #1, #7
**Fix:** Track dashboard-set values; on reload, preserve them unless `.env` explicitly changed.

### Fix #23: Request Count Persistence

**File:** `proxy/src/index.ts`
**Depends on:** #22
**Fix:** Persist `_reqCount` to SQLite, reload on startup.

### Fix #25: Configurable Strip Tags

**File:** `proxy/src/index.ts`
**Depends on:** nothing
**Fix:** Make `BULK_CONTEXT_TAGS` configurable via `CONTEXT_BULK_STRIP_TAGS` env var.

### Fix #26: Graceful Shutdown

**File:** `proxy/src/index.ts`
**Depends on:** nothing
**Fix:** Add SIGTERM/SIGINT handlers that close HTTP server, drain SSE, close SQLite, then exit.

---

## TESTING STRATEGY

Each fix includes:
1. **Unit test** in `proxy/test/` using `node:test` + `node:assert/strict`
2. **Typecheck:** `npm run typecheck` passes
3. **Formatter:** `npm run format` passes
4. **Full suite:** `npx tsx test/run.ts smoke` passes

### Test Commands by Fix

| Fix | Test Command |
|-----|-------------|
| #4 TTLMap | `npx tsx test/run.ts ttl-map` (new) |
| #24 Logger | `npx tsx test/run.ts dead-code` |
| #22 DB stub | `npx tsx test/run.ts db` (new) |
| #1 Config | `npx tsx test/run.ts config-reload` |
| #2 Router | `npx tsx test/run.ts router-system` (new) |
| #3 Reasoning | `npx tsx test/run.ts engine-reasoning` (new) |
| #5 Body limit | `npx tsx test/run.ts body-limit` (new) |
| #4a-c Memory | `npx tsx test/run.ts memory-ttl` (new) |
| #18 Auth | `npx tsx test/run.ts auth` (existing) |
| #17 Port | `npx tsx test/run.ts port-fallback` (new) |
| #12 DNS | `npx tsx test/run.ts dns-degraded` (new) |
| #6 Rate limit | `npx tsx test/run.ts rate-limit` (existing) |
| #7 Blocklist | `npx tsx test/run.ts blocklist` (existing) |
| #8 writeEnv | `npx tsx test/run.ts dashboard` (existing) |
| #9 Cache | `npx tsx test/run.ts cache-invalidation` (new) |
| #10 Anthropic | `npx tsx test/run.ts anthropic-adapter` (existing) |
| #11 Google | `npx tsx test/run.ts google-adapter` (existing) |
| #16 Tool args | `npx tsx test/run.ts tool-normalizer` (existing) |
| #15 Tool ID | `npx tsx test/run.ts tool-translation` (existing) |
| #14 Dedup | `npx tsx test/run.ts provider-adapters` (existing) |
| #13 SSE | `npx tsx test/run.ts dashboard` (existing) |

---

## EXECUTION SUMMARY

| Wave | Fixes | Parallelizable | Dependencies | Estimated Effort |
|------|-------|----------------|--------------|-----------------|
| **0** | #4, #24, #22 | ✅ All 3 in parallel | None | 0.5 day |
| **1** | #1, #2, #3, #5 | ✅ All 4 in parallel | #4 for #1 | 1 day |
| **2** | #4a, #4b, #4c, #18, #17, #12 | ✅ All 6 in parallel | #4 | 1.5 days |
| **3** | #6, #7, #8, #9 | ✅ All 4 in parallel | None | 1 day |
| **4** | #10, #11, #16, #15 | ✅ All 4 in parallel | None | 1 day |
| **5** | #14, #13 | ✅ Both in parallel | #10, #11 for #14 | 1 day |
| **6** | #19-#26 | ✅ All 7 in parallel | #1,#7 for #21; #22 for #23 | 1 day |
| **TOTAL** | **26 fixes** | | | **~7 days** |

---

## KEY RULES (from AGENTS.md)

- No `console.log` in production code — use `logger.info/warn/error`
- No `as any` hacks
- No `eval()`
- TypeScript strict mode
- No new runtime dependencies without strong justification
- All changes must pass `npm run typecheck`, `npm run format`, and `npm test`

---

*Generated from two deep codebase analysis passes. See git history for source files.*
