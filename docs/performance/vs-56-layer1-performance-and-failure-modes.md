# VS-56 — Layer 1 performance and failure modes (`artist.user_relationship.v1`)

Operational expectations for the offline Layer 1 evidence job (`layer1_evidence_recompute` on the analytics BullMQ queue). Numbers are **implementation contracts**; tune only with explicit product review.

## Bounded work per job

| Boundary | Where | Default / limits |
| --- | --- | --- |
| Users per job | `layer1EvidenceRecomputePayloadSchema` (`packages/queue/src/job-contracts.ts`) | `explicit_user_ids`: 1–200 UUIDs; `user_cursor_batch`: `limit` 1–500 |
| Top artists per user | `recomputeArtistUserRelationshipLayer1ForUser30dTop` | `artistLimit` job field 1–50 (optional); default **5** (`DEFAULT_ARTIST_FANOUT`) |
| Rolling window | `playedAtLowerBoundUtc("30d", nowMs)` | Fixed **30d** grain ending at `nowMsAnchorIso` |
| Window plays per user+artist | `artistUserRelationshipLayer1Recompute.ts` | **`LAYER1_MAX_WINDOW_PLAYS_PER_ARTIST` (20_000)**. Fetches `cap + 1` rows ordered by `played_at`, `track_id`; if more than `cap` exist, that artist is **skipped** with outcome `window_plays_exceed_processing_cap` (logged; no partial evidence for that artist). |

All paths above execute inside `layer1_evidence_recompute` (or tests calling the same primitive). The dashboard bundle recompute does **not** invoke Layer 1 inline; scheduling is documented in [VS-92](../implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md).

## Failure visibility and recovery

| Situation | Persistence | Worker behavior |
| --- | --- | --- |
| Per-artist upsert error | `upsert_failed` outcome; run may still finalize | Counted in rollup; run can end `failed` if any artist failure |
| Per-user thrown exception | `layer1_signal_runs.status = failed`, user rollup `userHardError` | Same |
| Orchestrator exception before finalize | `finalizeLayer1SignalRun` with `layer1_recompute_orchestrator_exception` | Error rethrown |
| Any aggregate failure path | `layer1_signal_runs` row finalized `failed`, `errorCode` set | `processAnalyticsJob` throws **`UnrecoverableError`** so BullMQ does not blindly retry a completed failed run |

Structured logs: `logQueueActivity` (`apps/worker/src/analyticsQueueProcessor.ts`) emits per-job totals; each user rollup logs `layer1_success` / `skip` / `insufficiency` / `failure` / hard-error flags. Console lines use the `vs-worker:layer1_recompute` and `vs-db:artistUserRelationshipLayer1` prefixes.

**Recovery:** Evidence upserts are **idempotent** (deterministic `signal_instance_id`). Operators may enqueue a new `layer1_evidence_recompute` job for the same scope after fixing data or infra; cursor batches advance by user id regardless of prior run outcome.

## Reasonable performance expectations

- **Latency scales with** `(users in scope) × (artistLimit) × (O(window plays) bounded by cap))` plus fixed aggregate queries per artist (lifetime bounds, pre-window last listen).
- **Very heavy single-artist windows** (e.g. bot-like repeat scrobbling) hit the window play cap: those artists are skipped for that run rather than loading unbounded rows into Node.
- **Postgres**: hot paths use indexed `listens (user_id, played_at)` and scoped artist filters; see migration `1744560000002_core-schema-import-jobs-scrobbles-listens.cjs` for base indexes.

## Follow-up (out of VS-56 scope)

- Streaming or server-side aggregation for window metrics when product requires evidence beyond the current cap without skipping.
- Operator-facing UI for `layer1_signal_runs` (today: SQL / admin tooling).
