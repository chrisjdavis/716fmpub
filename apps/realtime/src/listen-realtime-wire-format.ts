/**
 * JSON frames sent to browsers after auth. Kept minimal so payloads stay small
 * and the contract can be tested without running Postgres or `ws`.
 */
export function buildListensUpdatedFrame(vsEventId: string): string {
  return JSON.stringify({
    type: "listens_updated" as const,
    vs_event_id: vsEventId,
  });
}

export function buildReadyFrame(): string {
  return JSON.stringify({ type: "ready" as const });
}
