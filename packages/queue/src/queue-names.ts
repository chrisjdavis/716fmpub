/**
 * Canonical BullMQ queue names shared by API producers and the worker.
 * Use these constants only — ad-hoc strings are unsupported.
 *
 * Domain queues (`IMPORTS`, `EXPORTS`, `ANALYTICS`, `SYNC`, `INCREMENTAL_SYNC`) require validated
 * payloads: use `enqueue-validated` helpers when publishing and `job-contracts`
 * parsers when consuming so payloads are never left unvalidated.
 */
export const VS_QUEUE_NAMES = {
  /** Local smoke / wiring validation; safe to drain in dev. */
  SMOKE_TEST: "vs-smoke-test",
  /** Last.fm and related ingestion; see `job-contracts.ts` for job names. */
  IMPORTS: "imports",
  /** User / operator export artifact generation. */
  EXPORTS: "exports",
  /** Windowed aggregates and other offline analytics recompute jobs. */
  ANALYTICS: "analytics",
  /** Listen catch-up and related explicit sync triggers. */
  SYNC: "sync",
  /** Background `system_sync` import rows — bounded incremental Last.fm pulls; not `imports`. */
  INCREMENTAL_SYNC: "incremental_sync",
} as const;

export type VsQueueName = (typeof VS_QUEUE_NAMES)[keyof typeof VS_QUEUE_NAMES];
