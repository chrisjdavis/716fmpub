export const IMPORT_PIPELINE_STAGES = [
  "idle",
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export type ImportPipelineStage = (typeof IMPORT_PIPELINE_STAGES)[number];

const STAGE_SET = new Set<string>(IMPORT_PIPELINE_STAGES);

export function parseImportPipelineStage(
  value: string,
): ImportPipelineStage | null {
  return STAGE_SET.has(value) ? (value as ImportPipelineStage) : null;
}
