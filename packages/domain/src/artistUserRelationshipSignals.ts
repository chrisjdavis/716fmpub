import { createHash } from "node:crypto";
import type { JsonValue } from "./evidence/jsonValue.js";
import { layer1EvidenceScopeStableJson } from "./evidence/layer1SignalPersistence.js";
import {
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
  type Layer1ComparabilityFlags,
  type Layer1DeterministicScores,
  type Layer1EvidenceObject,
  type Layer1EvidenceScope,
  type Layer1Insufficiency,
} from "./evidence/layer1EvidenceObject.js";

/** Stable metric family for Layer 1 artist–user relationship rows (VS-48 TASK 2.3). */
export const ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1 =
  "716fm.artist.user_relationship.v1" as const;

export const ARTIST_USER_RELATIONSHIP_SIGNAL_KIND =
  "artist.user_relationship.v1" as const;

export const ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION = "1" as const;

/** Thirty-day gap (ms), aligned with returning-artist SQL in `userWindowSignalsRecompute`. */
export const ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS = 30 * 86_400_000;

/** Match {@link DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS.minPlaysForComparability} default. */
export const DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS = Object.freeze({
  minPlaysForDownstreamEligibility: 3,
});

export type ArtistUserRelationshipPlayRow = Readonly<{
  playedAtMs: number;
  trackId: string;
}>;

export type ArtistEntityRef = Extract<
  Layer1EvidenceScope,
  { kind: "artist" }
>["artistEntity"];

const MBID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * RFC-4122-shaped UUID derived from a stable seed (version 4 variant bits).
 * Used so dashboard recomputes replace the same `layer1_evidence_objects` row.
 */
export function deterministicUuidFromSeed(seed: string): string {
  const h = createHash("sha256").update(seed, "utf8").digest();
  const b = Buffer.allocUnsafe(16);
  h.copy(b, 0, 0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Stable `signal_instance_id` for artist relationship evidence for one user, artist
 * entity, and temporal window (ms bounds).
 */
export function deterministicArtistUserRelationshipSignalInstanceId(input: Readonly<{
  userId: string;
  artistEntity: ArtistEntityRef;
  windowStartInclusiveMs: number;
  windowEndExclusiveMs: number;
}>): string {
  const scope: Layer1EvidenceScope = {
    kind: "artist",
    userId: input.userId,
    artistEntity: input.artistEntity,
  };
  const seed = [
    ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
    layer1EvidenceScopeStableJson(scope),
    String(input.windowStartInclusiveMs),
    String(input.windowEndExclusiveMs),
  ].join("\n");
  return deterministicUuidFromSeed(seed);
}

export function isCanonicalArtistMbidString(value: string): boolean {
  return MBID_UUID_RE.test(value.trim());
}

export type ArtistUserRelationshipSignalsInput = Readonly<{
  temporalWindowMs: Readonly<{
    startInclusiveMs: number;
    endExclusiveMs: number;
  }>;
  /** Raw plays in `[start,end)` for this user+artist; order-free. */
  windowPlays: readonly ArtistUserRelationshipPlayRow[];
  /**
   * Earliest listen to this artist (all time). When unknown, first-listen-in-window
   * detection and some durability fields stay null / ineligible (no silent fill).
   */
  lifetimeFirstListenAtMs: number | null;
  /** Latest listen strictly before `temporalWindowMs.startInclusiveMs`, if any. */
  lastListenBeforeWindowAtMs: number | null;
  /**
   * Latest listen for this user+artist through the trusted catalog horizon
   * (typically `max(played_at)` for that pair when the cursor is fresh).
   */
  lifetimeLastListenAtMs: number | null;
  /** Total plays all-time when known; otherwise null (durability ratios omitted). */
  lifetimePlayCount: number | null;
  /**
   * Catalog / listen-store observation bound (UTC epoch ms). Null means not supplied
   * → {@link Layer1Insufficiency} uses `MISSING_SOURCE`, not `STALE_SOURCE`.
   */
  catalogObservedThroughMs: number | null;
  /** Wall-clock ms used for insufficiency.evaluationAsOfMs. */
  evaluationAsOfMs: number;
  thresholds?: Partial<typeof DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS>;
}>;

export type ArtistUserRelationshipSignalsResult = Readonly<{
  metricFamily: typeof ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1;
  windowStartInclusiveMs: number;
  windowEndExclusiveMs: number;
  playCountInWindow: number;
  distinctTrackCountInWindow: number;
  /**
   * Distinct tracks divided by plays in window. Null when there are no plays
   * (no fake ratio).
   */
  trackExplorationRatio: number | null;
  /**
   * Mean plays per distinct track in window. Null when there are no distinct tracks.
   */
  engagementDepthMeanPlaysPerDistinctTrack: number | null;
  /**
   * Sum of play counts on tracks with count > 1, divided by total plays (matches
   * `userWindowSignalsRecompute` repeat weighting). Null when no plays.
   */
  repeatListenIntensity: number | null;
  dormantReturnEvent: boolean;
  /**
   * True when the user’s first-ever listen to this artist (all time) falls inside the
   * evaluated window. This is **not** catalog-level “emerging artist” novelty; it is
   * strictly a user–artist relationship milestone.
   */
  firstUserListenToArtistInWindow: boolean;
  relationshipSpanMs: number | null;
  lifetimePlayCount: number | null;
  /**
   * Window plays divided by lifetime plays when lifetime count is known and > 0.
   * Null otherwise (no fabricated share).
   */
  windowShareOfLifetimePlays: number | null;
  catalogCursorMissing: boolean;
  catalogStaleForWindow: boolean;
  sparseRelationshipInWindow: boolean;
  insufficiency: Layer1Insufficiency;
  comparability: Pick<
    Layer1ComparabilityFlags,
    | "metricFamily"
    | "comparableWithinUser"
    | "comparableAcrossUsers"
    | "comparableWithinArtistEntity"
    | "comparableAcrossTemporalWindowsOfSameGrain"
    | "comparableToPriorWindowSameGrain"
    | "comparableToYearAgoWindowSameGrain"
  >;
  deterministicScores: Layer1DeterministicScores;
}>;

function thresholdsMerged(
  o?: ArtistUserRelationshipSignalsInput["thresholds"],
): typeof DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS {
  return { ...DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS, ...o };
}

function windowWellFormed(w: ArtistUserRelationshipSignalsInput["temporalWindowMs"]): boolean {
  const { startInclusiveMs, endExclusiveMs } = w;
  if (!Number.isFinite(startInclusiveMs) || !Number.isFinite(endExclusiveMs)) {
    return false;
  }
  return endExclusiveMs > startInclusiveMs;
}

function catalogCoversWindowEnd(
  catalogObservedThroughMs: number | null,
  endExclusiveMs: number,
): boolean {
  if (catalogObservedThroughMs == null) {
    return false;
  }
  return catalogObservedThroughMs >= endExclusiveMs - 1;
}

/**
 * Deterministic artist–user relationship metrics for Layer 1. Callers supply all
 * listen facts; this module does not query databases.
 *
 * **Signals (TASK 2.3):**
 * - **Depth:** `engagement_depth_mean_plays_per_distinct_track` (mean plays per track in window).
 * - **Durability:** `relationship_span_ms`, optional `window_share_of_lifetime_plays` when lifetime totals are known.
 * - **Dormant return:** `dormant_return_event` (30d silence before window, with plays in window).
 * - **First user listen to artist (in window):** `first_user_listen_to_artist_in_window`
 *   when the user’s first-ever listen to this artist falls in the window (not global emerging-artist novelty).
 * - **Repeat vs exploration:** `repeat_listen_intensity` (SQL-aligned) and `track_exploration_ratio` (distinct / plays).
 */
export function computeArtistUserRelationshipSignals(
  input: ArtistUserRelationshipSignalsInput,
): ArtistUserRelationshipSignalsResult {
  const th = thresholdsMerged(input.thresholds);
  const w = input.temporalWindowMs;
  const windowOk = windowWellFormed(w);

  if (!windowOk) {
    const evaluationAsOfMs = Number.isFinite(input.evaluationAsOfMs)
      ? Math.max(0, input.evaluationAsOfMs)
      : 0;
    const insufficiency: Layer1Insufficiency = {
      evaluationAsOfMs,
      eligibleForDownstreamUse: false,
      codes: ["UNKNOWN_ELIGIBILITY"],
      structuredFactors: {
        window_well_formed: false,
      },
    };
    return {
      metricFamily: ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
      windowStartInclusiveMs: Number.isFinite(w.startInclusiveMs) ? w.startInclusiveMs : 0,
      windowEndExclusiveMs: Number.isFinite(w.endExclusiveMs) ? w.endExclusiveMs : 0,
      playCountInWindow: 0,
      distinctTrackCountInWindow: 0,
      trackExplorationRatio: null,
      engagementDepthMeanPlaysPerDistinctTrack: null,
      repeatListenIntensity: null,
      dormantReturnEvent: false,
      firstUserListenToArtistInWindow: false,
      relationshipSpanMs: null,
      lifetimePlayCount: input.lifetimePlayCount,
      windowShareOfLifetimePlays: null,
      catalogCursorMissing: input.catalogObservedThroughMs == null,
      catalogStaleForWindow: false,
      sparseRelationshipInWindow: true,
      insufficiency,
      comparability: {
        metricFamily: ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
        comparableWithinUser: false,
        comparableAcrossUsers: false,
        comparableWithinArtistEntity: false,
        comparableAcrossTemporalWindowsOfSameGrain: false,
        comparableToPriorWindowSameGrain: false,
        comparableToYearAgoWindowSameGrain: false,
      },
      deterministicScores: { values: {} },
    };
  }

  const { startInclusiveMs, endExclusiveMs } = w;
  const evaluationAsOfMs = Math.max(0, input.evaluationAsOfMs);

  const finiteRows = input.windowPlays.filter(
    (r) =>
      Number.isFinite(r.playedAtMs) &&
      typeof r.trackId === "string" &&
      r.trackId.length > 0,
  );
  const inWindow = finiteRows.filter(
    (r) => r.playedAtMs >= startInclusiveMs && r.playedAtMs < endExclusiveMs,
  );
  const sorted = [...inWindow].sort((a, b) => {
    if (a.playedAtMs !== b.playedAtMs) {
      return a.playedAtMs - b.playedAtMs;
    }
    return a.trackId.localeCompare(b.trackId);
  });

  const playCountInWindow = sorted.length;
  const trackToCount = new Map<string, number>();
  for (const r of sorted) {
    trackToCount.set(r.trackId, (trackToCount.get(r.trackId) ?? 0) + 1);
  }
  const distinctTrackCountInWindow = trackToCount.size;

  let repeatWeighted = 0;
  for (const c of trackToCount.values()) {
    if (c > 1) {
      repeatWeighted += c;
    }
  }

  const trackExplorationRatio =
    playCountInWindow > 0 ? distinctTrackCountInWindow / playCountInWindow : null;
  const engagementDepthMeanPlaysPerDistinctTrack =
    distinctTrackCountInWindow > 0 ? playCountInWindow / distinctTrackCountInWindow : null;
  const repeatListenIntensity =
    playCountInWindow > 0 ? repeatWeighted / playCountInWindow : null;

  const first = input.lifetimeFirstListenAtMs;
  const firstUserListenToArtistInWindow =
    first != null &&
    Number.isFinite(first) &&
    first >= startInclusiveMs &&
    first < endExclusiveMs;

  const lb = input.lastListenBeforeWindowAtMs;
  const dormantReturnEvent =
    playCountInWindow > 0 &&
    lb != null &&
    Number.isFinite(lb) &&
    lb < startInclusiveMs - ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS;

  const lf = input.lifetimeFirstListenAtMs;
  const ll = input.lifetimeLastListenAtMs;
  const relationshipSpanMs =
    lf != null &&
    ll != null &&
    Number.isFinite(lf) &&
    Number.isFinite(ll) &&
    ll >= lf
      ? ll - lf
      : null;

  const lifetimePc = input.lifetimePlayCount;
  const windowShareOfLifetimePlays =
    lifetimePc != null &&
    Number.isFinite(lifetimePc) &&
    lifetimePc > 0 &&
    Number.isInteger(lifetimePc)
      ? playCountInWindow / lifetimePc
      : null;

  const catalogCursorMissing = input.catalogObservedThroughMs == null;
  const catalogStaleForWindow =
    input.catalogObservedThroughMs != null &&
    !catalogCoversWindowEnd(input.catalogObservedThroughMs, endExclusiveMs);

  const sparseRelationshipInWindow = playCountInWindow < th.minPlaysForDownstreamEligibility;

  const codes: string[] = [];
  if (sparseRelationshipInWindow) {
    codes.push("INSUFFICIENT_SAMPLE");
  }
  if (catalogCursorMissing) {
    codes.push("MISSING_SOURCE");
  } else if (catalogStaleForWindow) {
    codes.push("STALE_SOURCE");
  }

  const eligibleForDownstreamUse = codes.length === 0;

  const insufficiency: Layer1Insufficiency = {
    evaluationAsOfMs,
    eligibleForDownstreamUse,
    codes: eligibleForDownstreamUse ? (["OK"] as const) : [...codes],
    structuredFactors: {
      window_duration_ms: endExclusiveMs - startInclusiveMs,
      play_count_in_window: playCountInWindow,
      distinct_track_count_in_window: distinctTrackCountInWindow,
      sparse_relationship_in_window: sparseRelationshipInWindow,
      catalog_cursor_missing: catalogCursorMissing,
      catalog_stale_for_window: catalogStaleForWindow,
      dormant_return_event: dormantReturnEvent,
      first_user_listen_to_artist_in_window: firstUserListenToArtistInWindow,
      lifetime_first_listen_known: lf != null,
      lifetime_last_listen_known: ll != null,
      lifetime_play_count_known: lifetimePc != null,
    },
  };

  const comparability = {
    metricFamily: ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
    comparableWithinUser: eligibleForDownstreamUse,
    comparableAcrossUsers: false,
    comparableWithinArtistEntity: eligibleForDownstreamUse,
    comparableAcrossTemporalWindowsOfSameGrain: false,
    comparableToPriorWindowSameGrain: false,
    comparableToYearAgoWindowSameGrain: false,
  } as const;

  const values: Record<string, number> = {
    play_count_in_window: playCountInWindow,
    distinct_track_count_in_window: distinctTrackCountInWindow,
    window_duration_ms: endExclusiveMs - startInclusiveMs,
  };
  if (trackExplorationRatio != null) {
    values.track_exploration_ratio = trackExplorationRatio;
  }
  if (engagementDepthMeanPlaysPerDistinctTrack != null) {
    values.engagement_depth_mean_plays_per_distinct_track =
      engagementDepthMeanPlaysPerDistinctTrack;
  }
  if (repeatListenIntensity != null) {
    values.repeat_listen_intensity = repeatListenIntensity;
  }
  if (relationshipSpanMs != null) {
    values.relationship_span_ms = relationshipSpanMs;
  }
  if (lifetimePc != null && Number.isFinite(lifetimePc)) {
    values.lifetime_play_count_reported = lifetimePc;
  }
  if (windowShareOfLifetimePlays != null) {
    values.window_share_of_lifetime_plays = windowShareOfLifetimePlays;
  }
  if (dormantReturnEvent) {
    values.dormant_return_event = 1;
  }
  if (firstUserListenToArtistInWindow) {
    values.first_user_listen_to_artist_in_window = 1;
  }

  const deterministicScores: Layer1DeterministicScores = { values };

  return {
    metricFamily: ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
    windowStartInclusiveMs: startInclusiveMs,
    windowEndExclusiveMs: endExclusiveMs,
    playCountInWindow,
    distinctTrackCountInWindow,
    trackExplorationRatio,
    engagementDepthMeanPlaysPerDistinctTrack,
    repeatListenIntensity,
    dormantReturnEvent,
    firstUserListenToArtistInWindow,
    relationshipSpanMs,
    lifetimePlayCount: lifetimePc,
    windowShareOfLifetimePlays,
    catalogCursorMissing,
    catalogStaleForWindow,
    sparseRelationshipInWindow,
    insufficiency,
    comparability,
    deterministicScores,
  };
}

function resolveSourceObservedThroughMs(input: Readonly<{
  evaluationAsOfMs: number;
  emittedAtMs: number;
  catalogObservedThroughMs: number | null;
  /** Latest `played_at` in the evaluated window, or window start when empty. */
  windowMaxPlayedAtMs: number;
}>): number {
  const parts: number[] = [
    input.evaluationAsOfMs,
    input.emittedAtMs,
    input.windowMaxPlayedAtMs,
  ];
  if (
    input.catalogObservedThroughMs != null &&
    Number.isFinite(input.catalogObservedThroughMs)
  ) {
    parts.push(input.catalogObservedThroughMs);
  }
  return Math.min(...parts);
}

/**
 * Materializes {@link Layer1EvidenceObject} for artist-scoped relationship signals.
 * `emittedAtMs` is wall time; `sourceObservedThroughMs` is derived from catalog and play facts.
 */
export function buildArtistUserRelationshipLayer1Evidence(input: Readonly<{
  signalInstanceId: string;
  userId: string;
  artistEntity: ArtistEntityRef;
  emittedAtMs: number;
  signals: ArtistUserRelationshipSignalsInput;
}>): Layer1EvidenceObject {
  const emittedAtMs = Math.max(0, input.emittedAtMs);
  const computed = computeArtistUserRelationshipSignals(input.signals);
  const w = input.signals.temporalWindowMs;
  const windowPlays = input.signals.windowPlays.filter(
    (r) =>
      Number.isFinite(r.playedAtMs) &&
      r.playedAtMs >= w.startInclusiveMs &&
      r.playedAtMs < w.endExclusiveMs,
  );
  const windowMaxPlayedAtMs =
    windowPlays.length > 0
      ? Math.max(...windowPlays.map((r) => r.playedAtMs))
      : w.startInclusiveMs;
  const sourceObservedThroughMs = resolveSourceObservedThroughMs({
    evaluationAsOfMs: input.signals.evaluationAsOfMs,
    emittedAtMs,
    catalogObservedThroughMs: input.signals.catalogObservedThroughMs,
    windowMaxPlayedAtMs,
  });

  const payloadData: Record<string, JsonValue> = {
    metric_family: ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
    window_start_inclusive_ms: computed.windowStartInclusiveMs,
    window_end_exclusive_ms: computed.windowEndExclusiveMs,
    dormant_return_event: computed.dormantReturnEvent,
    first_user_listen_to_artist_in_window: computed.firstUserListenToArtistInWindow,
    play_count_in_window: computed.playCountInWindow,
    distinct_track_count_in_window: computed.distinctTrackCountInWindow,
    track_exploration_ratio: computed.trackExplorationRatio,
    engagement_depth_mean_plays_per_distinct_track:
      computed.engagementDepthMeanPlaysPerDistinctTrack,
    repeat_listen_intensity: computed.repeatListenIntensity,
    relationship_span_ms: computed.relationshipSpanMs,
    lifetime_play_count: computed.lifetimePlayCount,
    window_share_of_lifetime_plays: computed.windowShareOfLifetimePlays,
    catalog_cursor_missing: computed.catalogCursorMissing,
    catalog_stale_for_window: computed.catalogStaleForWindow,
    sparse_relationship_in_window: computed.sparseRelationshipInWindow,
    dormant_gap_ms: ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS,
    min_plays_for_downstream: DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS.minPlaysForDownstreamEligibility,
  };

  return {
    schemaVersion: LAYER1_EVIDENCE_SCHEMA_VERSION,
    signalInstanceId: input.signalInstanceId,
    signalKind: ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
    signalDefinitionVersion: ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION,
    emittedAtMs,
    sourceObservedThroughMs,
    scope: {
      kind: "artist",
      userId: input.userId,
      artistEntity: input.artistEntity,
    },
    payload: {
      format: LAYER1_JSON_PAYLOAD_FORMAT_V1,
      data: payloadData,
    },
    comparability: computed.comparability,
    insufficiency: computed.insufficiency,
    deterministicScores: computed.deterministicScores,
  };
}
