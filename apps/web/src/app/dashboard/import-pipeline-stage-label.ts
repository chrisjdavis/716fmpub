import type { ImportPipelineStage } from "@vs/domain";

/** Short label for dense tables; full phrase for progress readouts. */
export function importPipelineStageShortLabel(stage: ImportPipelineStage): string {
  switch (stage) {
    case "idle":
      return "Idle";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

/** Plain-language line for in-progress UI; `stage` remains available via `title` / tooltips. */
export function importPipelineStageSentence(stage: ImportPipelineStage): string {
  switch (stage) {
    case "idle":
      return "Idle — this job is not active.";
    case "queued":
      return "Queued — waiting for a worker to start.";
    case "running":
      return "Running — pages are being imported.";
    case "completed":
      return "Completed.";
    case "failed":
      return "Failed — import stopped with an error.";
  }
}
