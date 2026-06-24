/**
 * Session store for OpenCode Go context caching.
 * Maps conversation IDs to session IDs returned by the API.
 * The proxy captures the session_id from the first response
 * and sends it back on follow-up requests for cache discounts.
 */

const sessionStore = new Map<string, string>();

export function setSessionId(convId: string, sessionId: string): void {
  sessionStore.set(convId, sessionId);
}

export function getSessionId(convId: string): string | undefined {
  return sessionStore.get(convId);
}

export function clearSessionId(convId: string): void {
  sessionStore.delete(convId);
}
