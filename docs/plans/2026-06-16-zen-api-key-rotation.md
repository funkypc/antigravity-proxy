# Zen API Key Rotation Implementation Plan

## Problem
When using Zen (OpenCode) API, users may have multiple API keys from different accounts. When one key reaches its credit limit (CreditsError), requests fail. The current system doesn't automatically rotate to the next available key.

## Root Cause Analysis
1. **Single key per provider**: Currently only one `OPENCODE_API_KEY` is supported
2. **No key rotation**: When a key fails, there's no mechanism to try the next key
3. **Error detection**: CreditsError (401) is not treated as a rotation trigger

## Solution Overview
Add API key rotation specifically for Zen provider:
- Store multiple API keys in a separate config file
- Create a key manager that tracks key status and rotates on failure
- Detect CreditsError and other limit-related errors
- Add cooldown period for failed keys
- Add UI to manage keys in the Config tab

## Architecture

### New Files
1. `proxy/src/key-rotation.ts` - Key manager with rotation logic
2. `proxy/zen-keys.json` - Storage for multiple API keys
3. Dashboard UI updates for key management

### Modified Files
1. `proxy/src/adapters/zen.ts` - Use key manager instead of single key
2. `proxy/src/dashboard.ts` - Add API endpoints for key management
3. `proxy/dashboard/index.html` - Add key management UI

## Detailed Design

### 1. Key Manager (`proxy/src/key-rotation.ts`)

```typescript
interface ZenKey {
  id: string;
  key: string;
  label: string;
  lastUsed: number;
  lastError: string | null;
  errorCount: number;
  cooldownUntil: number;
}

interface KeyRotationConfig {
  keys: ZenKey[];
  currentIndex: number;
  cooldownMs: number;  // Default: 5 minutes
  maxErrors: number;   // Default: 3 before cooldown
}
```

**Key rotation logic:**
1. Start with first key
2. On success: update `lastUsed` timestamp
3. On CreditsError/401: 
   - Increment `errorCount`
   - If `errorCount >= maxErrors`: set `cooldownUntil` = now + cooldownMs
   - Move to next available key
4. On cooldown: skip keys with `cooldownUntil > now`
5. On 429 (rate limit): move to next key immediately
6. Periodically check if cooldown keys have recovered

### 2. Config File (`proxy/zen-keys.json`)

```json
{
  "keys": [
    {
      "id": "key-1",
      "key": "sk-abc123...",
      "label": "Account 1",
      "lastUsed": 0,
      "lastError": null,
      "errorCount": 0,
      "cooldownUntil": 0
    },
    {
      "id": "key-2",
      "key": "sk-def456...",
      "label": "Account 2",
      "lastUsed": 0,
      "lastError": null,
      "errorCount": 0,
      "cooldownUntil": 0
    }
  ],
  "currentIndex": 0,
  "cooldownMs": 300000,
  "maxErrors": 3
}
```

### 3. Zen Adapter Changes (`proxy/src/adapters/zen.ts`)

Modify to use key manager:
- Accept `KeyRotationManager` instead of single `apiKey`
- Call `getNextKey()` before each request
- Report success/failure to key manager
- Fall back to single key if no rotation keys configured

### 4. Dashboard UI

Add to Config tab:
- "Zen API Keys" section
- List of configured keys with status indicators
- Add/Remove key buttons
- Cooldown settings
- Key health status (green/yellow/red)

### 5. Error Detection

Detect these errors as rotation triggers:
- `CreditsError` - Account has no credits
- `401` with payment/billing message
- `429` - Rate limit
- `quota_exceeded` or similar

## Implementation Tasks

### Task 1: Key Manager Core
- Create `proxy/src/key-rotation.ts`
- Implement `KeyRotationManager` class
- Implement key selection logic
- Implement cooldown tracking
- Add persistence to `zen-keys.json`

### Task 2: Zen Adapter Integration
- Modify `proxy/src/adapters/zen.ts` to use key manager
- Add error detection for rotation triggers
- Implement key reporting (success/failure)

### Task 3: Dashboard API Endpoints
- `GET /api/zen-keys` - List all keys
- `POST /api/zen-keys` - Add new key
- `DELETE /api/zen-keys/:id` - Remove key
- `PUT /api/zen-keys/:id` - Update key
- `POST /api/zen-keys/test` - Test a key

### Task 4: Dashboard UI
- Add "Zen API Keys" section to Config tab
- Key list with status indicators
- Add/Remove/Edit buttons
- Cooldown settings
- Key health dashboard

### Task 5: Testing
- Unit tests for key rotation logic
- Integration tests for error detection
- Test cooldown behavior
- Test key recovery

## Edge Cases

1. **All keys exhausted**: Show error message, wait for cooldown
2. **Single key**: Works like current behavior (no rotation)
3. **Key added mid-rotation**: Immediately available
4. **Key removed mid-rotation**: Skip to next key
5. **Network errors**: Don't count as key failures (only API errors)
6. **Concurrent requests**: Thread-safe key selection

## Verification Plan

1. Add 2+ Zen API keys in dashboard
2. Send requests until one key hits limit
3. Verify automatic rotation to next key
4. Verify cooldown period works
5. Verify key recovery after cooldown
6. Test with single key (backward compatible)
