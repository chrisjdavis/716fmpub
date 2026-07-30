import type { ImportJobRecord, ImportJobSource } from "@vs/db";
import {
  parseImportPipelineStage,
  type ImportPipelineStage,
} from "@vs/domain/import/pipeline-stage";
import { sanitizeUserFacingPlainText } from "@vs/domain";

export type ImportJobApiRow = {
  id: string;
  label: string;
  lastfm_username: string;
  source: ImportJobSource;
  stage: ImportPipelineStage;
  error_message: string | null;
  items_total: number | null;
  items_processed: number;
  /**
   * Last.fm pages fully persisted for this run (server-sourced resume cursor).
   * JSON uses a number; the DB column is integer.
   */
  checkpoint_pages_completed: number;
  /**
   * Oldest listen `uts` on the last fully persisted page (`bigint` as decimal string in JSON).
   */
  checkpoint_oldest_uts: string | null;
  created_at: string;
  updated_at: string;
};

type ImportJobDbRow = {
  id: string;
  label: string;
  lastfm_username: string;
  source?: string;
  stage: string;
  error_message: string | null;
  items_total: number | null;
  items_processed: number;
  checkpoint_pages_completed?: number | string | null;
  checkpoint_oldest_uts?: string | number | bigint | null;
  created_at: string;
  updated_at: string;
};

function importJobSourceFromDb(raw: string | undefined): ImportJobSource {
  return raw === "system_sync" ? "system_sync" : "user";
}

/** Returns null when `stage` is not a valid pipeline value (data corruption). */
export function importJobApiRowFromDb(
  row: ImportJobDbRow,
): ImportJobApiRow | null {
  const stage = parseImportPipelineStage(row.stage);
  if (stage === null) {
    return null;
  }
  const rawCp = row.checkpoint_pages_completed;
  const rawOldest = row.checkpoint_oldest_uts;
  const checkpointPagesCompleted =
    rawCp === null || rawCp === undefined ? 0 : Number(rawCp);
  const checkpointOldestUts =
    rawOldest === null || rawOldest === undefined
      ? null
      : typeof rawOldest === "bigint"
        ? rawOldest.toString()
        : String(rawOldest);
  return {
    id: row.id,
    label: sanitizeUserFacingPlainText(row.label),
    lastfm_username: sanitizeUserFacingPlainText(row.lastfm_username),
    source: importJobSourceFromDb(row.source),
    stage,
    error_message:
      row.error_message === null ? null : sanitizeUserFacingPlainText(row.error_message),
    items_total: row.items_total,
    items_processed: row.items_processed,
    checkpoint_pages_completed: Number.isFinite(checkpointPagesCompleted)
      ? checkpointPagesCompleted
      : 0,
    checkpoint_oldest_uts: checkpointOldestUts,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Maps a repository `ImportJobRecord` (already stage-validated) to the HTTP API row shape. */
export function importJobApiRowFromRecord(
  record: ImportJobRecord,
): ImportJobApiRow {
  return {
    id: record.id,
    label: sanitizeUserFacingPlainText(record.label),
    lastfm_username: sanitizeUserFacingPlainText(record.lastfm_username),
    source: record.source,
    stage: record.stage,
    error_message:
      record.error_message === null ? null : sanitizeUserFacingPlainText(record.error_message),
    items_total: record.items_total,
    items_processed: record.items_processed,
    checkpoint_pages_completed: record.checkpoint_pages_completed,
    checkpoint_oldest_uts:
      record.checkpoint_oldest_uts === null
        ? null
        : record.checkpoint_oldest_uts.toString(),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}
