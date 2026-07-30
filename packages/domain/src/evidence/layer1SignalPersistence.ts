import type { Layer1EvidenceScope } from "./layer1EvidenceObject.js";

/**
 * Layer 1 — versioning and idempotency for durable signal materializations
 * ========================================================================
 *
 * **Wire vs storage**
 * - `LAYER1_EVIDENCE_SCHEMA_VERSION` (see `layer1EvidenceObject.ts`) versions the
 *   JSON object shape (`Layer1EvidenceObject`). Bump only on breaking wire changes.
 * - `signalDefinitionVersion` on each object versions the extractor / recipe that
 *   produced that payload. It lives **inside** the stored JSON body, not in the DB
 *   row key, so deploys can ship new extractors without minting new `analytics_snapshots`
 *   rows for the same logical slot.
 *
 * **Persistence modes used in this product**
 * - **Durable evidence rows:** `layer1_evidence_objects` stores one row per
 *   `signal_instance_id` with `body_json` plus first-class columns for
 *   insufficiency and comparability (including prior-window / year-ago flags) so
 *   eligibility is queryable without inferring from missing rows or ambiguous nulls.
 * - **Replace upsert:** one row per `(user_id, kind)` on `analytics_snapshots`
 *   (`UNIQUE (user_id, kind)`). Recompute runs `INSERT … ON CONFLICT DO UPDATE`,
 *   replacing `body` and advancing `updated_at`. The prior JSON body is not kept in
 *   Postgres; that is **replace**, not append-only history.
 * - **Not supersede-as-new-row:** we do not insert a second row for the same logical
 *   key to “version” outputs; supersession is expressed by overwriting the single row.
 * - **Stale-object invalidation (read-time):** correctness-critical readers probe
 *   canonical sources (e.g. `listens.played_at` vs snapshot `as_of`, or evidence
 *   `sourceObservedThroughMs` contracts) and treat snapshots as stale or non-authoritative
 *   without deleting or soft-flagging the row. That is **visibility of staleness**, not
 *   a second persistence mode on write.
 *
 * **Idempotency**
 * - `buildLayer1AnalyticsSnapshotKind` defines the stable `analytics_snapshots.kind`
 *   token for a logical materialization slot (user + signal recipe + evidence scope).
 * - Reruns with the same inputs target the same kind → same row → upsert replace;
 *   uncontrolled duplicate rows for that slot cannot accumulate under normal writers.
 *
 * **Auditability**
 * - Authoritative “what the user sees now” is the current row body + `updated_at`.
 * - Point-in-time audit trails are a **non-goal** for this table; if required, use a
 *   dedicated append-only audit store keyed by `signalInstanceId` / job ids.
 */

/** Re-exported at package boundary for callers documenting Layer 1 + DB rows together. */
export {
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
} from "./layer1EvidenceObject.js";

/**
 * Versions the **snapshot kind string** scheme (`buildLayer1AnalyticsSnapshotKind`).
 * Bump when the kind grammar changes in a breaking way (e.g. new required segment).
 */
export const LAYER1_ANALYTICS_SNAPSHOT_KIND_SCHEME_VERSION = 1 as const;

/** Must align with `signalKind` in `layer1EvidenceObjectSchema`. */
const SIGNAL_KIND_SLUG_RE = /^[a-z][a-z0-9_.-]*$/;

export type Layer1AnalyticsSnapshotKindError =
  | { code: "invalid_signal_kind"; detail: string }
  | { code: "invalid_scope"; detail: string };

export type BuildLayer1AnalyticsSnapshotKindResult =
  | { ok: true; kind: string }
  | { ok: false; error: Layer1AnalyticsSnapshotKindError };

/**
 * Stable JSON for a scope; insertion order is fixed so output is deterministic
 * across engines for the same logical scope.
 */
export function layer1EvidenceScopeStableJson(scope: Layer1EvidenceScope): string {
  switch (scope.kind) {
    case "user":
      return JSON.stringify({ kind: "user", userId: scope.userId });
    case "artist":
      return JSON.stringify({
        kind: "artist",
        userId: scope.userId,
        artistEntity: scope.artistEntity,
      });
    case "window":
      return JSON.stringify({
        kind: "window",
        userId: scope.userId,
        temporalWindowMs: scope.temporalWindowMs,
        artistEntity: scope.artistEntity ?? null,
      });
  }
}

function assertScopeInvariants(scope: Layer1EvidenceScope): Layer1AnalyticsSnapshotKindError | null {
  if (scope.kind === "window") {
    const { startInclusiveMs, endExclusiveMs } = scope.temporalWindowMs;
    if (endExclusiveMs <= startInclusiveMs) {
      return {
        code: "invalid_scope",
        detail: "temporalWindowMs.endExclusiveMs must be greater than startInclusiveMs",
      };
    }
  }
  return null;
}

/**
 * Builds the `analytics_snapshots.kind` value for one Layer-1-backed materialized
 * snapshot slot. Writers must use this (or a fixed kind constant wired to the same
 * rules) so reruns stay idempotent under `UNIQUE (user_id, kind)`.
 */
export function buildLayer1AnalyticsSnapshotKind(input: Readonly<{
  signalKind: string;
  scope: Layer1EvidenceScope;
}>): BuildLayer1AnalyticsSnapshotKindResult {
  const { signalKind, scope } = input;
  if (
    typeof signalKind !== "string" ||
    signalKind.length < 1 ||
    signalKind.length > 128 ||
    !SIGNAL_KIND_SLUG_RE.test(signalKind)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_signal_kind",
        detail: "signalKind must be a non-empty slug [a-z][a-z0-9_.-]* up to 128 chars",
      },
    };
  }
  const scopeErr = assertScopeInvariants(scope);
  if (scopeErr) {
    return { ok: false, error: scopeErr };
  }
  const scopeJson = layer1EvidenceScopeStableJson(scope);
  const kind = `716fm.layer1.snapshot:v${LAYER1_ANALYTICS_SNAPSHOT_KIND_SCHEME_VERSION}:${signalKind}:${scopeJson}`;
  return { ok: true, kind };
}

/** Frozen summary of recompute + read semantics for tests and operator tooling. */
export const LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS = Object.freeze({
  table: "analytics_snapshots",
  uniqueness: "unique (user_id, kind)",
  /** Implementation: `ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL` in `packages/db/src/analyticsSnapshotsUpsert.ts`. */
  replaceUpsertSqlRef: "packages/db/src/analyticsSnapshotsUpsert.ts#ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL",
  writeIntent: "replace",
  duplicateRowsPerKey: "prevented_by_unique_constraint",
  staleHandling: "read_time_probe_against_canonical_sources",
  priorBodyRetentionInDb: "none",
} as const);
