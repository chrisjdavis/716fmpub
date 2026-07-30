/**
 * VS-54 — Realistic listening-history **import-shaped** rows for Layer 1 / analytics validation.
 *
 * Each profile yields {@link RawImportListenRow} data meant for
 * {@link batchInsertRawImportListenRowsThenCanonicalize} (or the equivalent
 * `batchInsertRawScrobbles` + `canonicalizePendingRawScrobblesBatch` sequence).
 *
 * **Fixture clock:** {@link SIGNAL_VALIDATION_FIXTURE_NOW_MS} (2026-04-23 UTC). Assertions
 * in tests should pass `nowMs` / evaluation anchors relative to this instant unless overridden.
 *
 * @module
 */
import { deterministicUuidFromSeed } from "@vs/domain";
import type { RawImportListenRow } from "../rawScrobbles.js";
import { batchInsertRawScrobbles } from "../rawScrobbles.js";
import { canonicalizePendingRawScrobblesBatch } from "../canonicalizeRawScrobbles.js";
import type { Pool } from "pg";

/** Wall-clock anchor for rolling windows in docs and tests (2026-04-23T17:00:00.000Z). */
export const SIGNAL_VALIDATION_FIXTURE_NOW_MS = Date.UTC(2026, 3, 23, 17, 0, 0);

/** Intended `users.stats_timezone` for all VS-54 profiles (local streak / daypart realism). */
export const SIGNAL_VALIDATION_STATS_TIMEZONE_IANA = "America/New_York" as const;

export const SIGNAL_VALIDATION_PROFILE_IDS = [
  "rich_long_term",
  "sparse_partial_importer",
  "exploratory_listener",
] as const;

export type SignalValidationListenProfileId = (typeof SIGNAL_VALIDATION_PROFILE_IDS)[number];

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MIN = 60_000;

/** Stable Last.fm-style epoch seconds for `uts`; uniqueness is per-row `seq`. */
const UTS_BASE = 1_746_010_000n;

function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

function assertProfile(id: string): asserts id is SignalValidationListenProfileId {
  if (!SIGNAL_VALIDATION_PROFILE_IDS.includes(id as SignalValidationListenProfileId)) {
    throw new Error(`Unknown signal validation profile: ${id}`);
  }
}

/** Deterministic user id per profile (for scripts + local DB seeding). */
export function signalValidationSeedUserId(profile: SignalValidationListenProfileId): string {
  return deterministicUuidFromSeed(`716fm.vs54.signal_validation.user:${profile}`);
}

/** Stable import job id for tests that want a fixed foreign key. */
export function signalValidationSeedImportJobId(profile: SignalValidationListenProfileId): string {
  return deterministicUuidFromSeed(`716fm.vs54.signal_validation.import_job:${profile}`);
}

/** Human-readable contract for operators / Layer 1 validation. */
export const SIGNAL_VALIDATION_PROFILE_EXPECTATIONS: Readonly<
  Record<
    SignalValidationListenProfileId,
    Readonly<{
      label: string;
      intent: readonly string[];
    }>
  >
> = {
  rich_long_term: {
    label: "Heavy listener with multi-year tail, commute-style streak, deliberate burst, and a dormant return",
    intent: [
      "Multi-hundred-day span so period rollups and long tails are non-trivial.",
      "≥10 consecutive local active days in America/New_York (commute-hour bias, not uniform noise).",
      "≥1 default-threshold burst chain (≤90s gaps, ≥4 plays) for temporal burst validation.",
      "Same core artist quiet for >30d then plays again inside the recent window for dormant-return style checks.",
    ],
  },
  sparse_partial_importer: {
    label: "Very low play count spread across a wide calendar span (partial / sparse coverage)",
    intent: [
      "Total plays in O(10) with gaps of many days — exercises sparse coverage and low sample depth.",
      "Few distinct artists/tracks so exploration / repeat metrics are edge-heavy, not mid-distribution noise.",
    ],
  },
  exploratory_listener: {
    label: "Dense short window with many distinct tracks and artists (exploration-heavy)",
    intent: [
      "High distinct-track ratio inside a ~30d-shaped tail for exploration / low-repeat intensity.",
      "Many artists in one window for diversity-heavy dashboard and relationship summaries.",
    ],
  },
};

const MBID = {
  milesArtist: "c0ffee00-0000-4000-8000-000000000101",
  milesAlbum: "c0ffee00-0000-4000-8000-0000000001a1",
  milesT1: "c0ffee00-0000-4000-8000-000000000201",
  milesT2: "c0ffee00-0000-4000-8000-000000000202",
  milesT3: "c0ffee00-0000-4000-8000-000000000203",
  ninaArtist: "c0ffee00-0000-4000-8000-000000000102",
  ninaAlbum: "c0ffee00-0000-4000-8000-0000000001a2",
  ninaT1: "c0ffee00-0000-4000-8000-000000000211",
  kraftArtist: "c0ffee00-0000-4000-8000-000000000103",
  kraftAlbum: "c0ffee00-0000-4000-8000-0000000001a3",
  kraftT1: "c0ffee00-0000-4000-8000-000000000221",
} as const;

function baseRow(
  seq: number,
  playedAtMs: number,
  r: Omit<RawImportListenRow, "uts" | "playedAt" | "rawPayload">,
): RawImportListenRow {
  return {
    ...r,
    uts: UTS_BASE + BigInt(seq),
    playedAt: isoUtc(playedAtMs),
    rawPayload: { vs54: true, seq },
  };
}

function buildRichLongTerm(nowMs: number, startSeq: number): RawImportListenRow[] {
  const rows: RawImportListenRow[] = [];
  let seq = startSeq;

  const push = (playedAtMs: number, spec: Omit<RawImportListenRow, "uts" | "playedAt" | "rawPayload">) => {
    seq += 1;
    rows.push(baseRow(seq, playedAtMs, spec));
  };

  // --- Deep history: Miles Anchor cluster (establishes long relationship tail) ---
  for (let d = 0; d < 8; d += 1) {
    const dayMs = nowMs - (320 + d) * MS_PER_DAY;
    const evening = dayMs + 22 * MS_PER_MIN;
    push(evening, {
      artistName: "Miles Anchor",
      albumName: "Kind of Teal",
      trackName: d % 3 === 0 ? "So What If" : d % 3 === 1 ? "Blue in Green Screen" : "Freddie Freeloader App",
      artistMbid: MBID.milesArtist,
      albumMbid: MBID.milesAlbum,
      trackMbid: d % 3 === 0 ? MBID.milesT1 : d % 3 === 1 ? MBID.milesT2 : MBID.milesT3,
      loved: false,
    });
  }

  // --- Mid history: other artists (non-uniform spacing) ---
  const scatterDays = [260, 255, 240, 220, 200, 185, 170, 155, 130, 115, 100, 92, 88];
  for (let i = 0; i < scatterDays.length; i += 1) {
    const t = nowMs - scatterDays[i]! * MS_PER_DAY + 10 * MS_PER_MIN * (i % 5);
    const mod = i % 3;
    if (mod === 0) {
      push(t, {
        artistName: "Nina Pulse",
        albumName: "Strange Pulse",
        trackName: "West End Algorithm",
        artistMbid: MBID.ninaArtist,
        albumMbid: MBID.ninaAlbum,
        trackMbid: MBID.ninaT1,
        loved: false,
      });
    } else if (mod === 1) {
      push(t, {
        artistName: "Kraftwerk Grid",
        albumName: "Computer World Tour",
        trackName: "Pocket Calculator Live",
        artistMbid: MBID.kraftArtist,
        albumMbid: MBID.kraftAlbum,
        trackMbid: MBID.kraftT1,
        loved: false,
      });
    } else {
      push(t, {
        artistName: "Miles Anchor",
        albumName: "Kind of Teal",
        trackName: "Blue in Green Screen",
        artistMbid: MBID.milesArtist,
        albumMbid: MBID.milesAlbum,
        trackMbid: MBID.milesT2,
        loved: true,
      });
    }
  }

  // --- Dormant-return setup: Miles goes quiet for >45d then returns inside the last month ---
  const milesGapStart = nowMs - 75 * MS_PER_DAY;
  push(milesGapStart + 19 * MS_PER_MIN, {
    artistName: "Miles Anchor",
    albumName: "Kind of Teal",
    trackName: "So What If",
    artistMbid: MBID.milesArtist,
    albumMbid: MBID.milesAlbum,
    trackMbid: MBID.milesT1,
    loved: false,
  });
  push(milesGapStart + 48 * MS_PER_MIN, {
    artistName: "Miles Anchor",
    albumName: "Kind of Teal",
    trackName: "Freddie Freeloader App",
    artistMbid: MBID.milesArtist,
    albumMbid: MBID.milesAlbum,
    trackMbid: MBID.milesT3,
    loved: false,
  });

  for (let r = 0; r < 6; r += 1) {
    const t = nowMs - (18 - r * 2) * MS_PER_DAY + 20 * MS_PER_MIN;
    push(t, {
      artistName: "Miles Anchor",
      albumName: "Kind of Teal",
      trackName: r % 2 === 0 ? "So What If" : "Blue in Green Screen",
      artistMbid: MBID.milesArtist,
      albumMbid: MBID.milesAlbum,
      trackMbid: r % 2 === 0 ? MBID.milesT1 : MBID.milesT2,
      loved: false,
    });
  }

  // --- Local streak: consecutive civil days ~12:00 UTC → consecutive America/New_York days in April ---
  for (let i = 0; i < 14; i += 1) {
    const dayMs = Date.UTC(2026, 3, 10 + i, 12, 0, 0);
    push(dayMs + 15 * MS_PER_MIN, {
      artistName: "Nina Pulse",
      albumName: "Strange Pulse",
      trackName: "West End Algorithm",
      artistMbid: MBID.ninaArtist,
      albumMbid: MBID.ninaAlbum,
      trackMbid: MBID.ninaT1,
      loved: false,
    });
    push(dayMs + 9 * MS_PER_HOUR, {
      artistName: "Kraftwerk Grid",
      albumName: "Computer World Tour",
      trackName: "Pocket Calculator Live",
      artistMbid: MBID.kraftArtist,
      albumMbid: MBID.kraftAlbum,
      trackMbid: MBID.kraftT1,
      loved: false,
    });
  }

  // --- Burst: six plays ≤90s apart (default burst detector) on 2026-04-22 UTC evening ---
  const burstStart = Date.UTC(2026, 3, 22, 23, 30, 0);
  for (let j = 0; j < 6; j += 1) {
    push(burstStart + j * 45_000, {
      artistName: "Miles Anchor",
      albumName: "Kind of Teal",
      trackName: j % 2 === 0 ? "So What If" : "Blue in Green Screen",
      artistMbid: MBID.milesArtist,
      albumMbid: MBID.milesAlbum,
      trackMbid: j % 2 === 0 ? MBID.milesT1 : MBID.milesT2,
      loved: false,
    });
  }

  return rows;
}

function buildSparsePartialImporter(nowMs: number, startSeq: number): RawImportListenRow[] {
  const rows: RawImportListenRow[] = [];
  let seq = startSeq;
  const push = (playedAtMs: number, spec: Omit<RawImportListenRow, "uts" | "playedAt" | "rawPayload">) => {
    seq += 1;
    rows.push(baseRow(seq, playedAtMs, spec));
  };

  const offsets = [0, 9, 24, 41, 58, 71, 83, 91].map((d) => nowMs - d * MS_PER_DAY);
  const tracks = [
    { a: "Miles Anchor", t: "So What If", tm: MBID.milesT1, am: MBID.milesArtist, al: MBID.milesAlbum },
    { a: "Nina Pulse", t: "West End Algorithm", tm: MBID.ninaT1, am: MBID.ninaArtist, al: MBID.ninaAlbum },
    { a: "Kraftwerk Grid", t: "Pocket Calculator Live", tm: MBID.kraftT1, am: MBID.kraftArtist, al: MBID.kraftAlbum },
    { a: "Miles Anchor", t: "Freddie Freeloader App", tm: MBID.milesT3, am: MBID.milesArtist, al: MBID.milesAlbum },
    { a: "Nina Pulse", t: "West End Algorithm", tm: MBID.ninaT1, am: MBID.ninaArtist, al: MBID.ninaAlbum },
    { a: "Kraftwerk Grid", t: "Pocket Calculator Live", tm: MBID.kraftT1, am: MBID.kraftArtist, al: MBID.kraftAlbum },
    { a: "Miles Anchor", t: "Blue in Green Screen", tm: MBID.milesT2, am: MBID.milesArtist, al: MBID.milesAlbum },
    { a: "Nina Pulse", t: "West End Algorithm", tm: MBID.ninaT1, am: MBID.ninaArtist, al: MBID.ninaAlbum },
  ] as const;

  for (let i = 0; i < offsets.length; i += 1) {
    const tr = tracks[i]!;
    push(offsets[i]! + 14 * MS_PER_MIN, {
      artistName: tr.a,
      albumName: tr.a === "Miles Anchor" ? "Kind of Teal" : tr.a === "Nina Pulse" ? "Strange Pulse" : "Computer World Tour",
      trackName: tr.t,
      artistMbid: tr.am,
      albumMbid: tr.al,
      trackMbid: tr.tm,
      loved: false,
    });
  }
  return rows;
}

function buildExploratoryListener(nowMs: number, startSeq: number): RawImportListenRow[] {
  const rows: RawImportListenRow[] = [];
  let seq = startSeq;
  const push = (playedAtMs: number, spec: Omit<RawImportListenRow, "uts" | "playedAt" | "rawPayload">) => {
    seq += 1;
    rows.push(baseRow(seq, playedAtMs, spec));
  };

  const artistCount = 16;
  const plays = 48;
  for (let i = 0; i < plays; i += 1) {
    const dayOffset = 1 + Math.floor(i / 3);
    const ms = nowMs - dayOffset * MS_PER_DAY - (i % 5) * MS_PER_HOUR;
    const artistIdx = i % artistCount;
    const artistMbid = deterministicUuidFromSeed(`vs54-expl-artist-${artistIdx}`);
    const albumMbid = deterministicUuidFromSeed(`vs54-expl-album-${artistIdx}`);
    const trackMbid = deterministicUuidFromSeed(`vs54-expl-track-${i}`);
    const artistName = `716FM Explore Artist ${String(artistIdx).padStart(2, "0")}`;
    push(ms, {
      artistName,
      albumName: `Self Titled ${String(artistIdx).padStart(2, "0")}`,
      trackName: `Deep Cut ${String(i).padStart(3, "0")}`,
      artistMbid,
      albumMbid,
      trackMbid,
      loved: i % 17 === 0,
    });
  }
  return rows;
}

/**
 * Builds deterministic Last.fm-shaped import rows for the given profile.
 *
 * @param profileId - One of {@link SIGNAL_VALIDATION_PROFILE_IDS}
 * @param options.nowMs - Defaults to {@link SIGNAL_VALIDATION_FIXTURE_NOW_MS}
 * @param options.startSeq - Optional starting offset for `uts` / payload disambiguation when merging fixtures
 */
export function buildSignalValidationRawImportRows(
  profileId: SignalValidationListenProfileId,
  options?: Readonly<{ nowMs?: number; startSeq?: number }>,
): RawImportListenRow[] {
  assertProfile(profileId);
  const nowMs = options?.nowMs ?? SIGNAL_VALIDATION_FIXTURE_NOW_MS;
  const startSeq = options?.startSeq ?? 0;
  if (profileId === "rich_long_term") {
    return buildRichLongTerm(nowMs, startSeq);
  }
  if (profileId === "sparse_partial_importer") {
    return buildSparsePartialImporter(nowMs, startSeq);
  }
  return buildExploratoryListener(nowMs, startSeq);
}

/** Matches {@link batchInsertRawScrobbles} + {@link canonicalizePendingRawScrobblesBatch} pool surface. */
export type SignalValidationSeedDb = Pick<Pool, "query" | "connect">;

/**
 * Inserts raw scrobbles then canonicalizes into `listens` for one user/job.
 */
export async function batchInsertRawImportListenRowsThenCanonicalize(
  db: SignalValidationSeedDb,
  input: Readonly<{
    userId: string;
    importJobId: string;
    profileId: SignalValidationListenProfileId;
    nowMs?: number;
    startSeq?: number;
    canonicalizeLimit?: number;
  }>,
): Promise<
  Readonly<{
    rowCount: number;
    inserted: number;
    skippedDuplicates: number;
    canonicalized: { examined: number; succeeded: number; failed: number };
  }>
> {
  assertProfile(input.profileId);
  const rows = buildSignalValidationRawImportRows(input.profileId, {
    nowMs: input.nowMs,
    startSeq: input.startSeq,
  });
  const ins = await batchInsertRawScrobbles(db, {
    importJobId: input.importJobId,
    userId: input.userId,
    rows,
  });
  const canon = await canonicalizePendingRawScrobblesBatch(db, {
    importJobId: input.importJobId,
    userId: input.userId,
    limit: input.canonicalizeLimit ?? 5000,
  });
  return {
    rowCount: rows.length,
    inserted: ins.inserted,
    skippedDuplicates: ins.skippedDuplicates,
    canonicalized: canon,
  };
}
