import { z } from "zod";
import { parseImportPipelineStage } from "@vs/domain/import/pipeline-stage";
import type { ImportJobApiRow } from "@/server/api/import-job-row";

const importJobRowShapeSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    lastfm_username: z.string(),
    source: z.enum(["user", "system_sync"]).optional(),
    stage: z.string(),
    error_message: z.string().nullable(),
    items_total: z.number().nullable(),
    items_processed: z.number(),
    checkpoint_pages_completed: z.number(),
    checkpoint_oldest_uts: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

function importJobApiRowFromUnknown(row: unknown): ImportJobApiRow | "invalid_shape" | "invalid_stage" {
  const parsed = importJobRowShapeSchema.safeParse(row);
  if (!parsed.success) {
    return "invalid_shape";
  }
  const stage = parseImportPipelineStage(parsed.data.stage);
  if (stage === null) {
    return "invalid_stage";
  }
  return {
    ...parsed.data,
    source: parsed.data.source ?? "user",
    stage,
  };
}

const envelopeSchema = z.object({ latest: z.unknown() }).strict();

export type ParsedImportLatestResponse =
  | { ok: true; latest: ImportJobApiRow | null }
  | { ok: false; error: string };

/**
 * Validates `GET /api/imports/latest` JSON. Rejects shapes that do not match the route contract.
 */
export function parseImportLatestGetJson(body: unknown): ParsedImportLatestResponse {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    return { ok: false, error: "[ERROR: RESPONSE CONTRACT MISMATCH]" };
  }
  if (envelope.data.latest === null) {
    return { ok: true, latest: null };
  }
  const row = importJobApiRowFromUnknown(envelope.data.latest);
  if (row === "invalid_shape") {
    return { ok: false, error: "[ERROR: RESPONSE CONTRACT MISMATCH]" };
  }
  if (row === "invalid_stage") {
    return { ok: false, error: "[ERROR: INVALID IMPORT JOB ROW]" };
  }
  return { ok: true, latest: row };
}
