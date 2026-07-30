import {
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  buildArtistUserRelationshipLayer1Evidence,
  deterministicArtistUserRelationshipSignalInstanceId,
  isCanonicalArtistMbidString,
} from "@vs/domain";
import { playedAtLowerBoundUtc, type DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import { upsertLayer1EvidenceObject } from "./layer1EvidenceObjectUpsert.js";

const DEFAULT_ARTIST_FANOUT = 5 as const;

/**
 * Maximum window-scoped listen rows loaded per user+artist for Layer 1
 * `artist.user_relationship.v1`. When a window exceeds this, the artist is skipped
 * (no partial metrics). See `docs/performance/vs-56-layer1-performance-and-failure-modes.md`.
 */
export const LAYER1_MAX_WINDOW_PLAYS_PER_ARTIST = 20_000 as const;

export type ArtistUserRelationshipLayer1ArtistOutcome =
  | {
      kind: "skip";
      reason: "no_mbid" | "no_window_plays" | "window_plays_exceed_processing_cap";
    }
  | {
      kind: "materialized";
      signalInstanceId: string;
      eligibleForDownstreamUse: boolean;
      insufficiencyCodesJoined: string;
    }
  | { kind: "upsert_failed"; signalInstanceId: string; detail: string };

export type RecomputeArtistUserRelationshipLayer1ForUser30dTopResult = Readonly<{
  userSkipped: "no_30d_anchor_window" | null;
  artistOutcomes: readonly ArtistUserRelationshipLayer1ArtistOutcome[];
}>;

export function summarizeArtistOutcomes(
  outcomes: readonly ArtistUserRelationshipLayer1ArtistOutcome[],
): Readonly<{
  success: number;
  skip: number;
  insufficiency: number;
  failure: number;
}> {
  let success = 0;
  let skip = 0;
  let insufficiency = 0;
  let failure = 0;
  for (const o of outcomes) {
    if (o.kind === "skip") {
      skip += 1;
    } else if (o.kind === "upsert_failed") {
      failure += 1;
    } else if (o.eligibleForDownstreamUse) {
      success += 1;
    } else {
      insufficiency += 1;
    }
  }
  return { success, skip, insufficiency, failure };
}

/**
 * For the rolling **30d** window ending at `nowMs`, upserts `artist.user_relationship.v1`
 * Layer 1 evidence for the top `artistLimit` canonical artists by play volume in that window.
 * Artists without a valid MusicBrainz artist UUID in `artists.musicbrainz_artist_mbid` are skipped
 * (no `lastfm_artist_url_key` fallback in this pass).
 *
 * Idempotent: keyed by deterministic `signal_instance_id` replace-upsert semantics.
 */
export async function recomputeArtistUserRelationshipLayer1ForUser30dTop(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    nowMs: number;
    artistLimit?: number;
    layer1SignalRunId?: string | null;
    /**
     * Overrides {@link LAYER1_MAX_WINDOW_PLAYS_PER_ARTIST} (integration tests only;
     * production enqueue paths must omit this).
     */
    windowPlaysFetchCap?: number;
  }>,
): Promise<RecomputeArtistUserRelationshipLayer1ForUser30dTopResult> {
  const limit = input.artistLimit ?? DEFAULT_ARTIST_FANOUT;
  const windowPlaysCap =
    input.windowPlaysFetchCap != null && Number.isFinite(input.windowPlaysFetchCap)
      ? Math.max(1, Math.floor(input.windowPlaysFetchCap))
      : LAYER1_MAX_WINDOW_PLAYS_PER_ARTIST;
  const windowPlaySqlLimit = windowPlaysCap + 1;
  const since = playedAtLowerBoundUtc("30d", input.nowMs);
  if (since === null) {
    return { userSkipped: "no_30d_anchor_window", artistOutcomes: [] };
  }
  const startMs = since.getTime();
  const endMs = input.nowMs;
  const windowStartDate = since;
  const windowEndDate = new Date(endMs);
  const runId = input.layer1SignalRunId ?? null;

  const { rows: top } = await db.query<{ artist_id: string }>(
    `select t.artist_id::text as artist_id
       from listens l
       join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and l.played_at < $3::timestamptz
      group by t.artist_id
      order by count(*) desc, t.artist_id asc
      limit $4::int`,
    [input.userId, windowStartDate, windowEndDate, limit],
  );

  const artistOutcomes: ArtistUserRelationshipLayer1ArtistOutcome[] = [];

  for (const row of top) {
    const artistId = row.artist_id;
    const { rows: ar } = await db.query<{ mbid: string | null }>(
      `select musicbrainz_artist_mbid as mbid from artists where id = $1::uuid`,
      [artistId],
    );
    const rawMbid = ar[0]?.mbid?.trim() ?? "";
    if (!rawMbid || !isCanonicalArtistMbidString(rawMbid)) {
      artistOutcomes.push({ kind: "skip", reason: "no_mbid" });
      continue;
    }
    const artistEntity = {
      kind: "lastfm_artist_mbid" as const,
      mbid: rawMbid.toLowerCase(),
    };

    const { rows: wrows } = await db.query<{ played_at: Date; track_id: string }>(
      `select l.played_at, l.track_id::text as track_id
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and t.artist_id = $2::uuid
          and l.played_at >= $3::timestamptz
          and l.played_at < $4::timestamptz
        order by l.played_at asc, l.track_id asc
        limit $5::int`,
      [input.userId, artistId, windowStartDate, windowEndDate, windowPlaySqlLimit],
    );
    if (wrows.length === 0) {
      artistOutcomes.push({ kind: "skip", reason: "no_window_plays" });
      continue;
    }
    if (wrows.length > windowPlaysCap) {
      console.warn(
        `[vs-db:artistUserRelationshipLayer1] skip window_plays_exceed_processing_cap user_id=${input.userId} artist_id=${artistId} cap=${windowPlaysCap} fetched_rows=${wrows.length}`,
      );
      artistOutcomes.push({ kind: "skip", reason: "window_plays_exceed_processing_cap" });
      continue;
    }
    const windowPlays = wrows.map((r) => ({
      playedAtMs: r.played_at.getTime(),
      trackId: r.track_id,
    }));
    const maxWindowPlayedAtMs = Math.max(...windowPlays.map((p) => p.playedAtMs));

    const { rows: life } = await db.query<{
      first_ms: string | null;
      last_ms: string | null;
      total: string;
    }>(
      `select (extract(epoch from min(l.played_at)) * 1000)::bigint::text as first_ms,
              (extract(epoch from max(l.played_at)) * 1000)::bigint::text as last_ms,
              count(*)::text as total
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid and t.artist_id = $2::uuid`,
      [input.userId, artistId],
    );
    const l0 = life[0];
    const lifetimeFirstListenAtMs =
      l0?.first_ms != null ? Number(l0.first_ms) : null;
    const lifetimeLastListenAtMs = l0?.last_ms != null ? Number(l0.last_ms) : null;
    const lifetimePlayCountRaw = l0?.total != null ? Number(l0.total) : null;
    const lifetimePlayCount =
      lifetimePlayCountRaw != null &&
      Number.isFinite(lifetimePlayCountRaw) &&
      Number.isInteger(lifetimePlayCountRaw)
        ? lifetimePlayCountRaw
        : null;

    const { rows: lbRows } = await db.query<{ last_ms: string | null }>(
      `select (extract(epoch from max(l.played_at)) * 1000)::bigint::text as last_ms
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and t.artist_id = $2::uuid
          and l.played_at < $3::timestamptz`,
      [input.userId, artistId, windowStartDate],
    );
    const lastListenBeforeWindowAtMs =
      lbRows[0]?.last_ms != null ? Number(lbRows[0].last_ms) : null;

    const catalogObservedThroughMs =
      lifetimeLastListenAtMs != null && Number.isFinite(lifetimeLastListenAtMs)
        ? Math.max(lifetimeLastListenAtMs, maxWindowPlayedAtMs)
        : maxWindowPlayedAtMs;

    const signalInstanceId = deterministicArtistUserRelationshipSignalInstanceId({
      userId: input.userId,
      artistEntity,
      windowStartInclusiveMs: startMs,
      windowEndExclusiveMs: endMs,
    });

    const evidence = buildArtistUserRelationshipLayer1Evidence({
      signalInstanceId,
      userId: input.userId,
      artistEntity,
      emittedAtMs: endMs,
      signals: {
        temporalWindowMs: { startInclusiveMs: startMs, endExclusiveMs: endMs },
        windowPlays,
        lifetimeFirstListenAtMs,
        lastListenBeforeWindowAtMs,
        lifetimeLastListenAtMs,
        lifetimePlayCount,
        catalogObservedThroughMs,
        evaluationAsOfMs: endMs,
      },
    });

    const r = await upsertLayer1EvidenceObject(db, {
      userId: input.userId,
      evidence,
      layer1SignalRunId: runId,
    });
    if (!r.ok) {
      console.warn(
        `[vs-db:artistUserRelationshipLayer1] upsert_failed user_id=${input.userId} signal_kind=${ARTIST_USER_RELATIONSHIP_SIGNAL_KIND} detail=${r.error.detail}`,
      );
      artistOutcomes.push({
        kind: "upsert_failed",
        signalInstanceId,
        detail: r.error.detail,
      });
      continue;
    }
    const ins = evidence.insufficiency;
    artistOutcomes.push({
      kind: "materialized",
      signalInstanceId,
      eligibleForDownstreamUse: ins.eligibleForDownstreamUse,
      insufficiencyCodesJoined: ins.codes.join(","),
    });
  }

  const tier = summarizeArtistOutcomes(artistOutcomes);
  if (tier.failure > 0) {
    console.warn(
      `[vs-db:artistUserRelationshipLayer1] user_id=${input.userId} layer1_artist_failures=${tier.failure} success=${tier.success} skip=${tier.skip} insufficiency=${tier.insufficiency}`,
    );
  }

  return { userSkipped: null, artistOutcomes };
}
