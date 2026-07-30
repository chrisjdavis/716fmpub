# VS-71 — WebSocket payload volume and event chatter audit

This document inventories the **only** production WebSocket path in the repository (dashboard listen updates), quantifies payloads and publish drivers, reviews the consumer, and records a slimming plan. It aligns with **backend-as-source-of-truth** (push is invalidation only; no derived ETA/delay/stop fields on the wire) and **no-fake-precision** (this path does not assert freshness beyond “something changed for this user”).

## 1. Inventory — event types and directions

| Direction | When | JSON shape | Approx size |
| --- | --- | --- | --- |
| Client → server | First message after `open` | `{ "type": "auth", "token": "<signed token>" }` | Dominated by `token`: base64url JSON payload (`sub`, `exp`) + `"."` + 64-char hex HMAC (~150–220 bytes typical for UUID `sub`). |
| Server → client | After successful auth | `{ "type": "ready" }` | 18 bytes UTF-8. |
| Server → client | Each qualifying Postgres `NOTIFY` for the user’s room | `{ "type": "listens_updated", "vs_event_id": "<uuid>" }` | **< 200 bytes** (see `apps/realtime/src/listen-realtime-wire-format.ts` + contract test). |

**Code references:** server `apps/realtime/src/index.ts`, wire helpers `apps/realtime/src/listen-realtime-wire-format.ts`, client `apps/web/src/app/dashboard/dashboard-listen-fingerprint-poller.tsx`, handshake `apps/web/src/app/api/me/listen-realtime/route.ts`, token layout `packages/realtime-token/src/index.ts`.

**Other WebSocket usage:** `apps/web/scripts/performance-realtime-ws.ts` is a **benchmark harness only** (not shipped to browsers).

## 2. Publish frequency drivers

| Source | Channel / mechanism | Frequency model |
| --- | --- | --- |
| Postgres | `NOTIFY listen_change` with payload `{"user_id":"<uuid>"}` (`packages/db/migrations/1744560000010_listens-pg-notify-realtime.cjs`) | **One notification per row** on `listens` **INSERT** or **DELETE** for that user. Bulk imports or large deletes can produce **high fan-out**: each NOTIFY is relayed to every **open socket** in the user’s room as one `listens_updated` frame. |
| `apps/realtime` | `broadcast(userId)` | For each NOTIFY: one JSON string built once, sent to all sockets in the room (no per-client payload variance). |
| Browser (fallback) | `GET /api/me/listen-fingerprint` on interval `LISTEN_FINGERPRINT_POLL_MS` (**20_000** ms, `packages/domain/src/listenFingerprintPoll.ts`) | Steady HTTP polling when realtime is disabled **or** after WS error/close until reconnect succeeds. |

**Server-side perf logs (optional):** `VS_PERF_REALTIME` gates structured `vs_perf` lines for fan-out timing (`listens_fanout`), not extra client events.

## 3. Payload redundancy and size

- **Push payload:** Already minimal: no listen rows, counts, or timestamps on the WebSocket—only invalidation + correlation id. **No redundant fields** beyond `vs_event_id` (useful for perf correlation and client perf logs).
- **NOTIFY payload:** Small JSON (`user_id` only). The realtime service parses it and does not forward it to browsers (good boundary).
- **Auth message:** Largest client→server frame by design (HMAC token). **Mitigation (plan):** token TTL is already bounded (`TOKEN_TTL_SEC = 300` in `listen-realtime/route.ts`); further reduction would mean shorter TTL or a narrower signing payload (trade vs security review).

## 4. Consumer review — `DashboardListenFingerprintPoller`

- **Re-renders:** The component returns `null` and uses refs for fingerprint state → **no React subtree re-renders** from this module.
- **State churn / navigation:** On each `listens_updated` (and on fingerprint change when polling), it calls `startTransition(() => router.refresh())` → **full App Router refresh** for the current route tree. That is intentional for RSC freshness but is **the dominant UX cost** of each push, not the WebSocket byte count.
- **Polling interaction:** When the socket is healthy, polling is stopped; on close/error, polling restarts with exponential backoff reconnect (`scheduleWsReconnect`). No duplicate refresh from poll + WS for the same tick unless both paths race around reconnect (acceptable edge).

## 5. Streams with limited direct UX value

| Stream | Assessment |
| --- | --- |
| `listens_updated` | **Meaningful:** triggers dashboard server refresh so new listens eventually appear without user action. |
| `ready` | **Control-plane only** (not user-visible) but required for a deterministic handshake before trusting push. |
| Client `vs_perf` logs (`NEXT_PUBLIC_VS_CLIENT_PERF`) | **Operator-only**; default off. |

Nothing identified as **safe to remove** without replacing invalidation; the main risk is **chatter from NOTIFY volume**, not useless frame types.

## 6. Plan — slim payloads and reduce noisy patterns

| Priority | Item | Action |
| --- | --- | --- |
| P0 | NOTIFY storm on bulk `listens` writes | **Addressed (716fmpub):** statement-level triggers notify once per distinct `user_id` per statement (`1744560000044_listens-notify-statement-coalesce.cjs`); realtime bridge also coalesces fan-out (~75 ms trailing / 400 ms max wait). |
| P1 | `router.refresh()` cost per event | After coalescing NOTIFYs, **batch invalidation** so one user-visible refresh covers many rows; optionally narrow refresh scope if Next.js patterns allow partial revalidation without full route refresh (product decision). |
| P2 | `vs_event_id` size | If wire bytes matter at extreme scale, replace UUID with shorter opaque ids **only** if observability still correlates server-side (log both). |
| P3 | Handshake JSON | Keep `{ enabled, wsUrl, token }`; avoid adding optional fields clients must parse on every dashboard load. |

## 7. Explicit contracts and failure visibility (summary)

- **Contract:** Auth → `ready`; data plane → `listens_updated` with optional `vs_event_id` (client tolerates missing id for perf logging only).
- **Stale/missing:** If realtime is off, **JSON `enabled: false`** from `GET /api/me/listen-realtime` forces polling—no silent “live” UX. WS close falls back to polling with visible delay in updates (bounded by poll interval).
- **Further measurement:** WebSocket data-plane timing remains **`value: null` + reason** in the performance baseline harness until a controlled `listens` mutation is automated; see `docs/performance-audit-baseline.md`.
