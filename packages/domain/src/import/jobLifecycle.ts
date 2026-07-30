import type { ImportPipelineStage } from "./pipelineStage.js";

/**
 * Allowed one-step transitions for orchestration and tests.
 * Authoritative enforcement for persistence lives in `@vs/db` import job SQL
 * (`WHERE stage = …`); keep this map aligned when stages or paths change.
 */
const TERMINAL: ReadonlySet<ImportPipelineStage> = new Set([
  "completed",
  "failed",
]);

const ALLOWED: ReadonlyMap<
  ImportPipelineStage,
  ReadonlySet<ImportPipelineStage>
> = new Map([
  ["idle", new Set(["queued", "failed"])],
  ["queued", new Set(["running", "failed"])],
  /** `running -> queued` is used when a worker dies: stale rows are re-queued for a safe re-run (dedupe on inserts). */
  ["running", new Set(["completed", "failed", "queued"])],
  ["completed", new Set()],
  ["failed", new Set()],
]);

export function isTerminalImportJobStage(
  stage: ImportPipelineStage,
): boolean {
  return TERMINAL.has(stage);
}

/**
 * Returns whether `from` may advance to `to` in one step.
 * Terminal stages do not transition further.
 */
export function canTransitionImportJobStage(
  from: ImportPipelineStage,
  to: ImportPipelineStage,
): boolean {
  if (from === to) {
    return true;
  }
  const next = ALLOWED.get(from);
  return next?.has(to) ?? false;
}

export function assertTransitionImportJobStage(
  from: ImportPipelineStage,
  to: ImportPipelineStage,
): void {
  if (!canTransitionImportJobStage(from, to)) {
    throw new Error(
      `Unsupported import job stage transition: ${from} -> ${to}`,
    );
  }
}
