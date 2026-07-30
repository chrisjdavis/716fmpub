import type { Layer1EvidenceObject, Layer1EvidenceScope } from "@vs/domain";
import {
  extractLayer1EvidencePersistenceMetadata,
  layer1EvidenceScopeStableJson,
} from "@vs/domain";
import type { Pool, PoolClient } from "pg";

export type Layer1EvidenceObjectDbExecutor =
  | Pick<Pool, "query">
  | Pick<PoolClient, "query">;

export type UpsertLayer1EvidenceObjectResult =
  | { ok: true }
  | {
      ok: false;
      error: { code: "user_scope_mismatch"; detail: string };
    };

function userIdFromEvidenceScope(scope: Layer1EvidenceScope): string {
  return scope.userId;
}

type ScopeRow = Readonly<{
  scopeKind: string;
  windowStartMs: number | null;
  windowEndMs: number | null;
  artistEntityKind: string | null;
  artistMbid: string | null;
  artistUrlKey: string | null;
  scopeJson: string;
}>;

function scopeToRowParts(scope: Layer1EvidenceScope): ScopeRow {
  const scopeJson = layer1EvidenceScopeStableJson(scope);
  if (scope.kind === "user") {
    return {
      scopeKind: "user",
      windowStartMs: null,
      windowEndMs: null,
      artistEntityKind: null,
      artistMbid: null,
      artistUrlKey: null,
      scopeJson,
    };
  }
  if (scope.kind === "artist") {
    const ae = scope.artistEntity;
    if (ae.kind === "lastfm_artist_mbid") {
      return {
        scopeKind: "artist",
        windowStartMs: null,
        windowEndMs: null,
        artistEntityKind: "lastfm_artist_mbid",
        artistMbid: ae.mbid,
        artistUrlKey: null,
        scopeJson,
      };
    }
    return {
      scopeKind: "artist",
      windowStartMs: null,
      windowEndMs: null,
      artistEntityKind: "lastfm_artist_url_key",
      artistMbid: null,
      artistUrlKey: ae.urlKey,
      scopeJson,
    };
  }
  const tw = scope.temporalWindowMs;
  const ae = scope.artistEntity;
  if (ae?.kind === "lastfm_artist_mbid") {
    return {
      scopeKind: "window",
      windowStartMs: tw.startInclusiveMs,
      windowEndMs: tw.endExclusiveMs,
      artistEntityKind: "lastfm_artist_mbid",
      artistMbid: ae.mbid,
      artistUrlKey: null,
      scopeJson,
    };
  }
  if (ae?.kind === "lastfm_artist_url_key") {
    return {
      scopeKind: "window",
      windowStartMs: tw.startInclusiveMs,
      windowEndMs: tw.endExclusiveMs,
      artistEntityKind: "lastfm_artist_url_key",
      artistMbid: null,
      artistUrlKey: ae.urlKey,
      scopeJson,
    };
  }
  return {
    scopeKind: "window",
    windowStartMs: tw.startInclusiveMs,
    windowEndMs: tw.endExclusiveMs,
    artistEntityKind: null,
    artistMbid: null,
    artistUrlKey: null,
    scopeJson,
  };
}

/**
 * Idempotent replace of one `layer1_evidence_objects` row keyed by `signal_instance_id`.
 * Persists {@link Layer1EvidenceObject} in `body_json` and mirrors insufficiency +
 * comparability into first-class columns (VS-45).
 */
export async function upsertLayer1EvidenceObject(
  db: Layer1EvidenceObjectDbExecutor,
  input: Readonly<{
    userId: string;
    evidence: Layer1EvidenceObject;
    layer1SignalRunId?: string | null;
  }>,
): Promise<UpsertLayer1EvidenceObjectResult> {
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
  const scopeRow = scopeToRowParts(input.evidence.scope);
  const meta = extractLayer1EvidencePersistenceMetadata(input.evidence);
  const runId = input.layer1SignalRunId ?? null;
  const factors =
    meta.insufficiencyStructuredFactors === null
      ? null
      : meta.insufficiencyStructuredFactors;

  await db.query(
    `insert into layer1_evidence_objects (
        user_id,
        signal_instance_id,
        signal_kind,
        signal_definition_version,
        evidence_schema_version,
        scope_kind,
        window_start_ms,
        window_end_ms,
        artist_entity_kind,
        artist_mbid,
        artist_url_key,
        scope_json,
        body_json,
        layer1_signal_run_id,
        insufficiency_evaluation_as_of_ms,
        eligible_for_downstream_use,
        insufficiency_codes,
        insufficiency_structured_factors,
        comparability_metric_family,
        comparable_within_user,
        comparable_across_users,
        comparable_within_artist_entity,
        comparable_across_temporal_windows_same_grain,
        comparable_to_prior_window_same_grain,
        comparable_to_year_ago_window_same_grain
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5::smallint,
        $6,
        $7::bigint,
        $8::bigint,
        $9,
        $10::uuid,
        $11,
        $12::jsonb,
        $13::jsonb,
        $14::uuid,
        $15::bigint,
        $16::boolean,
        $17::text[],
        $18::jsonb,
        $19,
        $20::boolean,
        $21::boolean,
        $22::boolean,
        $23::boolean,
        $24::boolean,
        $25::boolean
      )
      on conflict (signal_instance_id) do update set
        user_id = excluded.user_id,
        signal_kind = excluded.signal_kind,
        signal_definition_version = excluded.signal_definition_version,
        evidence_schema_version = excluded.evidence_schema_version,
        scope_kind = excluded.scope_kind,
        window_start_ms = excluded.window_start_ms,
        window_end_ms = excluded.window_end_ms,
        artist_entity_kind = excluded.artist_entity_kind,
        artist_mbid = excluded.artist_mbid,
        artist_url_key = excluded.artist_url_key,
        scope_json = excluded.scope_json,
        body_json = excluded.body_json,
        layer1_signal_run_id = excluded.layer1_signal_run_id,
        insufficiency_evaluation_as_of_ms = excluded.insufficiency_evaluation_as_of_ms,
        eligible_for_downstream_use = excluded.eligible_for_downstream_use,
        insufficiency_codes = excluded.insufficiency_codes,
        insufficiency_structured_factors = excluded.insufficiency_structured_factors,
        comparability_metric_family = excluded.comparability_metric_family,
        comparable_within_user = excluded.comparable_within_user,
        comparable_across_users = excluded.comparable_across_users,
        comparable_within_artist_entity = excluded.comparable_within_artist_entity,
        comparable_across_temporal_windows_same_grain = excluded.comparable_across_temporal_windows_same_grain,
        comparable_to_prior_window_same_grain = excluded.comparable_to_prior_window_same_grain,
        comparable_to_year_ago_window_same_grain = excluded.comparable_to_year_ago_window_same_grain`,
    [
      input.userId,
      input.evidence.signalInstanceId,
      input.evidence.signalKind,
      input.evidence.signalDefinitionVersion,
      input.evidence.schemaVersion,
      scopeRow.scopeKind,
      scopeRow.windowStartMs,
      scopeRow.windowEndMs,
      scopeRow.artistEntityKind,
      scopeRow.artistMbid,
      scopeRow.artistUrlKey,
      scopeRow.scopeJson,
      JSON.stringify(input.evidence),
      runId,
      meta.insufficiencyEvaluationAsOfMs,
      meta.eligibleForDownstreamUse,
      [...meta.insufficiencyCodes],
      factors,
      meta.comparabilityMetricFamily,
      meta.comparableWithinUser,
      meta.comparableAcrossUsers,
      meta.comparableWithinArtistEntity,
      meta.comparableAcrossTemporalWindowsOfSameGrain,
      meta.comparableToPriorWindowSameGrain,
      meta.comparableToYearAgoWindowSameGrain,
    ],
  );
  return { ok: true };
}
