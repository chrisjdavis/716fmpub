import {
  buildLayer1AnalyticsSnapshotKind,
  type Layer1EvidenceObject,
  type Layer1EvidenceScope,
} from "@vs/domain";
import { replaceUpsertAnalyticsSnapshot, type AnalyticsSnapshotDbExecutor } from "./analyticsSnapshotsUpsert.js";

function userIdFromEvidenceScope(scope: Layer1EvidenceScope): string {
  return scope.userId;
}

export type UpsertLayer1EvidenceAnalyticsSnapshotResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | { code: "kind_build_failed"; detail: string }
        | { code: "user_scope_mismatch"; detail: string };
    };

/**
 * Persists one {@link Layer1EvidenceObject} into `analytics_snapshots` using
 * {@link buildLayer1AnalyticsSnapshotKind} for the row `kind` (idempotent under
 * `UNIQUE (user_id, kind)`).
 */
export async function upsertLayer1EvidenceAnalyticsSnapshot(
  db: AnalyticsSnapshotDbExecutor,
  input: Readonly<{ userId: string; evidence: Layer1EvidenceObject }>,
): Promise<UpsertLayer1EvidenceAnalyticsSnapshotResult> {
  const scopeUserId = userIdFromEvidenceScope(input.evidence.scope);
  if (scopeUserId !== input.userId) {
    return {
      ok: false,
      error: {
        code: "user_scope_mismatch",
        detail: "evidence.scope.userId must equal input.userId",
      },
    };
  }
  const kindResult = buildLayer1AnalyticsSnapshotKind({
    signalKind: input.evidence.signalKind,
    scope: input.evidence.scope,
  });
  if (!kindResult.ok) {
    return {
      ok: false,
      error: { code: "kind_build_failed", detail: kindResult.error.detail },
    };
  }
  await replaceUpsertAnalyticsSnapshot(db, {
    userId: input.userId,
    kind: kindResult.kind,
    bodyJson: JSON.stringify(input.evidence),
  });
  return { ok: true };
}
