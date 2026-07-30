import type { TimeMachineExploreAnchorAlbumRow, TimeMachineExploreAnchorTrackRow } from "@vs/db";
import {
  parseTimeMachineMonthYyyMm,
  sameUtcCalendarMonthOneYearPriorYyyMm,
  type TimeMachineMonthDensityRow,
  type TimeMachineMonthMetricsRow,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import {
  buildExploreNarrativeParagraph,
  ensureConcreteMusicInPrimaryNarrative,
  entityCandidatesForExploreMonth,
  type TimeMachineExploreNarrativeParagraph,
} from "./time-machine-explore-narrative";
import { applySingleExploreCardArt } from "./time-machine-explore-visuals";

export type TimeMachineNewArtistInPeriod = Readonly<{
  name: string;
  playsInPeriod: number;
}>;

export type TimeMachineModuleTagKey =
  | "NEW_AROUND_HERE"
  | "WHAT_STUCK"
  | "LISTENING_SHAPE"
  | "AT_THE_CENTER"
  | "COMPARED_WITH_BEFORE"
  | "WHAT_CARRIED_FORWARD"
  | "PERIOD_INTENSITY"
  | "THIS_PERIOD"
  | "OTHER";

export type TimeMachineModule = Readonly<{
  tagKey: TimeMachineModuleTagKey;
  tag: string;
  value: string;
  meta: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}>;

export type TimeMachineExploreCopy = Readonly<{
  periodLabel: string;
  /** Short reflective read (roughly 2–6 words). Not a stat line. */
  summaryLine: string | null;
  /** One line (UI: single row): compressed counts, pace, and where this month sits in its year (no UTC / rollup jargon). */
  contextStrip: readonly string[];
  /** Deeper story beat with a concrete anchor where possible. */
  primaryNarrative: TimeMachineExploreNarrativeParagraph | null;
  /** Prior-month or shape shift; only when the signal is strong. No section heading in UI. */
  comparisonNarrative: TimeMachineExploreNarrativeParagraph | null;
  /** Time-machine continuity (what follows, year-ago echo, threads). */
  continuityNarrative: TimeMachineExploreNarrativeParagraph | null;
  /** Collapsed “power user” facts: full counts, averages, year %, YoY. */
  detailLines: readonly string[];
  modules: readonly TimeMachineModule[];
}>;

function safeName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) {
    return null;
  }
  return sanitizeUserFacingPlainText(name);
}

function inferModuleTagKey(tag: string): TimeMachineModuleTagKey {
  switch (tag) {
    case "NEW AROUND HERE":
      return "NEW_AROUND_HERE";
    case "WHAT STUCK":
      return "WHAT_STUCK";
    case "LISTENING SHAPE":
      return "LISTENING_SHAPE";
    case "AT THE CENTER":
      return "AT_THE_CENTER";
    case "COMPARED WITH BEFORE":
      return "COMPARED_WITH_BEFORE";
    case "WHAT CARRIED FORWARD":
      return "WHAT_CARRIED_FORWARD";
    case "PERIOD INTENSITY":
      return "PERIOD_INTENSITY";
    case "THIS PERIOD":
      return "THIS_PERIOD";
    default:
      return "OTHER";
  }
}

function formatUtcMonthLong(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return yyyymm;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function formatUtcMonthNameOnly(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return yyyymm;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function formatMonthNameFromPeriodStartYmd(ymd: string): string | null {
  const key = ymd.trim().slice(0, 7);
  if (key.length < 7 || key[4] !== "-") {
    return null;
  }
  return formatUtcMonthNameOnly(key);
}

const MIN_PLAYS_WEAK = 4;
const MIN_PLAYS_COMPARE = 18;
const MIN_PRIOR_PLAYS_COMPARE = 12;

function meaningfulRatioChange(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) {
    return false;
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi / lo >= 1.25;
}

function dominantArtistShare(metrics: TimeMachineMonthMetricsRow, plays: number): number {
  if (plays <= 0 || metrics.top_artist_plays == null) {
    return 0;
  }
  return metrics.top_artist_plays / plays;
}

function isExploratoryForPlays(artists: number, plays: number): boolean {
  return artists >= Math.max(8, Math.floor(plays / 6));
}

function pickSummaryLine(input: Readonly<{
  plays: number;
  artists: number;
  dominantShare: number;
  topArtist: string | null;
  replayHeavy: boolean;
  exploratory: boolean;
  prior: TimeMachineMonthMetricsRow | null;
  newArtistCount: number;
}>): string | null {
  const { plays, artists, dominantShare, topArtist, replayHeavy, exploratory, prior, newArtistCount } = input;

  if (plays < 1) {
    return null;
  }
  if (plays < MIN_PLAYS_WEAK) {
    return "A light footprint.";
  }

  if (dominantShare >= 0.38 && topArtist) {
    return "A rotation-heavy stretch.";
  }
  if (exploratory && dominantShare < 0.32) {
    return "Nothing fully took over.";
  }
  if (newArtistCount >= 4) {
    return "New names in the mix.";
  }
  if (replayHeavy && !exploratory) {
    return "Familiar tracks on repeat.";
  }

  if (
    prior !== null &&
    prior.play_count >= MIN_PRIOR_PLAYS_COMPARE &&
    plays >= MIN_PLAYS_COMPARE &&
    meaningfulRatioChange(plays, prior.play_count)
  ) {
    if (plays > prior.play_count) {
      return "A busier stretch.";
    }
    return "A quieter phase.";
  }

  if (prior !== null && prior.play_count >= MIN_PRIOR_PLAYS_COMPARE && plays >= MIN_PLAYS_COMPARE) {
    const priorExploratory = isExploratoryForPlays(prior.unique_artist_count, prior.play_count);
    if (exploratory && !priorExploratory && meaningfulRatioChange(artists, Math.max(1, prior.unique_artist_count))) {
      return "Listening widens here.";
    }
    if (!exploratory && priorExploratory && artists < prior.unique_artist_count) {
      return "A tighter rotation.";
    }
  }

  return "A steady stretch.";
}

function utcCalendarDaysInMonthYyyMm(monthYyyMm: string): number | null {
  const key = parseTimeMachineMonthYyyMm(monthYyyMm);
  if (key === null) {
    return null;
  }
  const [ys, ms] = key.split("-").map(Number);
  if (!Number.isFinite(ys) || !Number.isFinite(ms)) {
    return null;
  }
  return new Date(Date.UTC(ys, ms, 0)).getUTCDate();
}

function monthListeningTierInYearPhrase(
  monthYyyMm: string,
  timeline: readonly TimeMachineMonthDensityRow[],
): string {
  const year = monthYyyMm.slice(0, 4);
  const monthName = formatUtcMonthNameOnly(monthYyyMm);
  const monthsInYear = timeline
    .filter((t) => t.period_start.startsWith(`${year}-`))
    .map((t) => ({
      key: t.period_start.slice(0, 7),
      plays: t.play_count,
    }));
  const current = monthsInYear.find((m) => m.key === monthYyyMm);
  if (!current || monthsInYear.length <= 1) {
    return `${monthName} is the stretch you have on record for ${year} in this archive.`;
  }
  const sorted = [...monthsInYear].sort((a, b) => a.plays - b.plays);
  const idx = sorted.findIndex((m) => m.key === monthYyyMm);
  const n = sorted.length;
  const band = Math.max(1, Math.ceil(n / 3));
  if (idx < band) {
    return `${monthName} sits on the quieter side of your ${year} listening`;
  }
  if (idx >= n - band) {
    return `${monthName} rides near the top of your ${year} listening`;
  }
  return `${monthName} sits mid-range for your ${year} listening`;
}

function buildContextStripLines(input: Readonly<{
  monthYyyMm: string;
  plays: number;
  artists: number;
  tracks: number;
  timeline: readonly TimeMachineMonthDensityRow[];
}>): string[] {
  const { monthYyyMm, plays, artists, tracks, timeline } = input;
  const line1 = `${plays.toLocaleString("en-US")} plays • ${artists.toLocaleString("en-US")} artists • ${tracks.toLocaleString("en-US")} tracks`;
  const days = utcCalendarDaysInMonthYyyMm(monthYyyMm);
  if (days === null || days < 1) {
    return [line1];
  }
  const avg = plays / days;
  const ppd = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10;
  const tier = monthListeningTierInYearPhrase(monthYyyMm, timeline);
  return [`${line1} • ~${ppd} plays/day • ${tier}`];
}

function buildDetailLines(input: Readonly<{
  monthYyyMm: string;
  plays: number;
  compactStatLine: string;
  yearMetrics: TimeMachineMonthMetricsRow | null;
  sameMonthPriorYear: TimeMachineMonthMetricsRow | null;
}>): string[] {
  const { monthYyyMm, plays, compactStatLine, yearMetrics, sameMonthPriorYear } = input;
  const out: string[] = [compactStatLine];
  const days = utcCalendarDaysInMonthYyyMm(monthYyyMm);
  if (days !== null && days >= 1 && plays >= 1) {
    const avg = plays / days;
    const r =
      avg >= 100
        ? Math.round(avg).toLocaleString("en-US")
        : avg >= 10
          ? (Math.round(avg * 10) / 10).toString()
          : (Math.round(avg * 100) / 100).toString();
    out.push(`${r} plays per day on average across ${formatUtcMonthLong(monthYyyMm)}.`);
  }
  out.push(...buildExploreContextLines({ monthYyyMm, plays, yearMetrics, sameMonthPriorYear }));
  return out;
}

function buildExploreContextLines(input: Readonly<{
  monthYyyMm: string;
  plays: number;
  yearMetrics: TimeMachineMonthMetricsRow | null;
  sameMonthPriorYear: TimeMachineMonthMetricsRow | null;
}>): string[] {
  const { monthYyyMm, plays, yearMetrics, sameMonthPriorYear } = input;
  const out: string[] = [];
  const y = Number(monthYyyMm.slice(0, 4));
  if (yearMetrics !== null && yearMetrics.play_count > 0 && plays > 0 && Number.isFinite(y)) {
    const pct = Math.round((plays / yearMetrics.play_count) * 100);
    const yPlays = yearMetrics.play_count.toLocaleString("en-US");
    out.push(
      `${y} calendar year in your archive: ${yPlays} plays total · this month ≈ ${pct}% of that year's listening.`,
    );
  }
  const yoyKey = sameUtcCalendarMonthOneYearPriorYyyMm(monthYyyMm);
  if (yoyKey !== null && sameMonthPriorYear !== null && sameMonthPriorYear.play_count > 0) {
    const label = formatUtcMonthLong(yoyKey);
    const yCount = sameMonthPriorYear.play_count.toLocaleString("en-US");
    if (plays >= MIN_PLAYS_COMPARE && sameMonthPriorYear.play_count >= MIN_PRIOR_PLAYS_COMPARE) {
      if (meaningfulRatioChange(plays, sameMonthPriorYear.play_count)) {
        const up = plays > sameMonthPriorYear.play_count;
        out.push(
          up
            ? `Same month last year (${label}): ${yCount} plays — you are well above that now.`
            : `Same month last year (${label}): ${yCount} plays — this year is quieter.`,
        );
      } else {
        out.push(`Same month last year (${label}): ${yCount} plays — about the same scale as now.`);
      }
    } else {
      out.push(`Same month last year (${label}): ${yCount} plays in your archive.`);
    }
  }
  return out;
}

function buildPrimaryExpansion(input: Readonly<{
  plays: number;
  artists: number;
  tracks: number;
  topArtist: string | null;
  topTrack: string | null;
  dominantShare: number;
  exploratory: boolean;
  replayHeavy: boolean;
  newArtistCount: number;
}>): string {
  const { plays, artists, tracks, topArtist, topTrack, dominantShare, exploratory, replayHeavy, newArtistCount } =
    input;

  if (plays < MIN_PLAYS_WEAK) {
    return "This was a quieter month, but not an empty one — a smaller sample, so the edges stay soft.";
  }
  if (topArtist && dominantShare >= 0.38) {
    return `This stretch leaned hard on ${topArtist}, with that name showing up again and again as the month moved.`;
  }
  if (topArtist && dominantShare >= 0.28) {
    return `Much of the month kept circling back to ${topArtist}, even while other voices still passed through your rotation.`;
  }
  if (exploratory) {
    if (topTrack && topArtist) {
      return `Nothing fully took over this month, but ${topTrack} by ${topArtist} kept drifting back in — the kind of stretch where favorites resurface without one act running the whole calendar.`;
    }
    if (topArtist) {
      return `Nothing fully took over this month, but ${topArtist} kept slipping back into rotation alongside everything else you were trying on.`;
    }
    return "Nothing fully took over this month, but a few familiar names kept resurfacing — you moved between a lot of artists without letting any one voice own the whole stretch.";
  }
  if (topArtist) {
    return `Nothing fully took over, yet ${topArtist} was still the clearest thread to hold onto when the rest of the month stayed in motion.`;
  }
  if (newArtistCount >= 2 && plays >= MIN_PLAYS_WEAK) {
    return "New names landed next to the regulars, so the month reads more like a handoff than a single locked-in groove.";
  }
  if (replayHeavy && tracks > 0) {
    return "Repeats carried a lot of the texture — the same titles kept returning even as you still touched a wider set of tracks.";
  }
  return "Your listening stayed split across several threads without one obvious anchor — more drift than a single headline act.";
}

function buildComparisonNatural(input: Readonly<{
  plays: number;
  artists: number;
  tracks: number;
  topArtist: string | null;
  topTrack: string | null;
  exploratory: boolean;
  replayHeavy: boolean;
  prior: TimeMachineMonthMetricsRow | null;
}>): string | null {
  const { plays, artists, tracks, topArtist, topTrack, exploratory, replayHeavy, prior } = input;
  const priorComparable =
    prior !== null &&
    prior.play_count >= MIN_PRIOR_PLAYS_COMPARE &&
    plays >= MIN_PLAYS_COMPARE;
  if (!priorComparable) {
    return null;
  }
  const priorMonthName =
    formatMonthNameFromPeriodStartYmd(prior.period_start) ?? "the month before";

  if (meaningfulRatioChange(plays, prior.play_count)) {
    const up = plays > prior.play_count;
    if (up) {
      return `This feels fuller than ${priorMonthName} — more spins in the log, a busier cadence, and a little less air between listens.`;
    }
    const replayBit =
      replayHeavy && tracks > 0 ? ", and more time spent circling back to the same tracks" : "";
    return `This feels softer than ${priorMonthName} — fewer spikes, less urgency${replayBit}.`;
  }

  const priorExploratory = isExploratoryForPlays(prior.unique_artist_count, prior.play_count);
  if (exploratory && !priorExploratory && meaningfulRatioChange(artists, Math.max(1, prior.unique_artist_count))) {
    return `Wider listening than ${priorMonthName} — more names in circulation, less clustering around the same few regulars.`;
  }
  if (!exploratory && priorExploratory) {
    return `After a broader ${priorMonthName}, your rotation tightens again — fewer names, more return visits to a smaller set of favorites.`;
  }
  if (replayHeavy && tracks > 0) {
    return `You kept circling back to the same tracks more than usual for how many different titles showed up — replay-heavy against the spread you still had on the shelf.`;
  }
  if (topTrack && topArtist) {
    return `${topTrack} by ${topArtist} kept resurfacing, giving the month a recognizable loop even without one artist owning the calendar.`;
  }
  return null;
}

function buildContinuityNatural(input: Readonly<{
  monthYyyMm: string;
  plays: number;
  topArtist: string | null;
  sameMonthPriorYear: TimeMachineMonthMetricsRow | null;
  timeline: readonly TimeMachineMonthDensityRow[];
  nextMonth: TimeMachineMonthMetricsRow | null;
  newArtistCount: number;
}>): string | null {
  const { monthYyyMm, plays, topArtist, sameMonthPriorYear, timeline, nextMonth, newArtistCount } = input;
  const parts: string[] = [];

  const nextTop = safeName(nextMonth?.top_artist_name);
  const topArtistOk = topArtist !== null && topArtist.trim().length > 0;
  const nextTopOk = nextTop !== null && nextTop.trim().length > 0;
  if (
    topArtistOk &&
    nextTopOk &&
    topArtist === nextTop &&
    nextMonth !== null &&
    nextMonth.play_count >= MIN_PLAYS_WEAK
  ) {
    parts.push(
      `${topArtist} is still your top artist in the month that follows — the same center of gravity, just the next page on the calendar.`,
    );
  }

  const months = timeline.map((t) => t.period_start.slice(0, 7));
  const idx = months.indexOf(monthYyyMm);
  if (idx >= 0 && idx < months.length - 1) {
    const nextKey = months[idx + 1];
    const nextRow = timeline.find((t) => t.period_start.slice(0, 7) === nextKey);
    if (nextRow !== undefined && plays >= MIN_PLAYS_WEAK) {
      const ratio = nextRow.play_count / Math.max(1, plays);
      if (ratio >= 1.25) {
        parts.push("What follows on your timeline ramps up from here — listening gains urgency again in the next month.");
      } else if (ratio <= 0.8) {
        parts.push("The next month on your timeline eases off after this — a softer landing before the picture shifts again.");
      } else if (parts.length === 0) {
        parts.push("What comes right after this holds a similar pace on your timeline — more continuation than a sharp turn.");
      }
    }
  }

  if (
    sameMonthPriorYear !== null &&
    sameMonthPriorYear.play_count >= MIN_PRIOR_PLAYS_COMPARE &&
    plays >= MIN_PLAYS_COMPARE &&
    meaningfulRatioChange(plays, sameMonthPriorYear.play_count)
  ) {
    const up = plays > sameMonthPriorYear.play_count;
    if (parts.length < 2) {
      parts.push(
        up
          ? "The same calendar window a year earlier was quieter in your archive — this pass carries more listening behind it."
          : "You had more plays logged in this same calendar window last year — this time around the volume eases off.",
      );
    }
  }

  if (parts.length === 0 && newArtistCount >= 5 && plays >= MIN_PLAYS_WEAK) {
    parts.push(
      "Several artists show up for the first time in this window — the month reads like a hinge before the stretch that follows.",
    );
  }

  if (parts.length === 0) {
    return null;
  }
  return parts.slice(0, 2).join(" ");
}

function rankNewArtistsForCard(
  ranked: readonly TimeMachineNewArtistInPeriod[],
): readonly { name: string; playsInPeriod: number }[] {
  const cleaned = ranked
    .map((r) => {
      const name = safeName(r.name);
      if (name === null || name.length === 0) {
        return null;
      }
      return { name, playsInPeriod: Math.max(0, r.playsInPeriod) };
    })
    .filter((r): r is { name: string; playsInPeriod: number } => r !== null);

  const withMultiPlay = cleaned.filter((r) => r.playsInPeriod >= 2);
  const pool = withMultiPlay.length > 0 ? withMultiPlay : cleaned;
  return [...pool].sort((a, b) => {
    if (b.playsInPeriod !== a.playsInPeriod) {
      return b.playsInPeriod - a.playsInPeriod;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Value line for NEW AROUND HERE; requires at least one displayable name. */
export function formatNewAroundHereValue(
  rankedNames: readonly string[],
  totalNewArtists: number,
): string | null {
  if (rankedNames.length === 0 || totalNewArtists < 1) {
    return null;
  }
  const a = rankedNames[0]!;
  if (totalNewArtists === 1) {
    return a;
  }
  const b = rankedNames[1];
  if (totalNewArtists === 2 && b) {
    return `${a} and ${b}`;
  }
  if (totalNewArtists === 3) {
    const c = rankedNames[2];
    if (b && c) {
      return `${a}, ${b}, and ${c}`;
    }
    if (b) {
      return `${a} and ${b}`;
    }
    return `${a} and 2 others`;
  }
  if (totalNewArtists > 3 && b) {
    const others = totalNewArtists - 2;
    return `${a}, ${b}, and ${others} ${others === 1 ? "other" : "others"}`;
  }
  if (totalNewArtists > 3) {
    const others = totalNewArtists - 1;
    return `${a} and ${others} ${others === 1 ? "other" : "others"}`;
  }
  return a;
}

function buildNewAroundHereModule(input: Readonly<{
  newArtistsRanked: readonly TimeMachineNewArtistInPeriod[];
  newArtistTotalCount: number;
  narrativeLower: string;
}>): TimeMachineModule | null {
  const { newArtistsRanked, newArtistTotalCount, narrativeLower } = input;
  if (newArtistTotalCount < 1 || newArtistsRanked.length === 0) {
    return null;
  }
  const ordered = rankNewArtistsForCard(newArtistsRanked);
  if (ordered.length === 0) {
    return null;
  }
  const nameList = ordered.map((r) => r.name);
  const value = formatNewAroundHereValue(nameList, newArtistTotalCount);
  if (value === null) {
    return null;
  }
  const meta =
    newArtistTotalCount <= 3
      ? "This is when they first start showing up in your archive."
      : "A broader discovery stretch than a single name could capture alone.";
  if (narrativeLower.includes("first time") && narrativeLower.includes("archive")) {
    return {
      tagKey: inferModuleTagKey("NEW AROUND HERE"),
      tag: "NEW AROUND HERE",
      value,
      meta: "Worth a dedicated look alongside the month’s wider story.",
    };
  }
  return {
    tagKey: inferModuleTagKey("NEW AROUND HERE"),
    tag: "NEW AROUND HERE",
    value,
    meta,
  };
}

function isPriorComparableForContrast(
  prior: TimeMachineMonthMetricsRow | null,
  plays: number,
): prior is TimeMachineMonthMetricsRow {
  return (
    prior !== null &&
    prior.play_count >= MIN_PRIOR_PLAYS_COMPARE &&
    plays >= MIN_PLAYS_COMPARE
  );
}

function buildComparedWithBeforeModule(input: Readonly<{
  plays: number;
  artists: number;
  exploratory: boolean;
  prior: TimeMachineMonthMetricsRow | null;
  narrativeLower: string;
}>): TimeMachineModule | null {
  const { plays, artists, exploratory, prior, narrativeLower } = input;
  if (!isPriorComparableForContrast(prior, plays)) {
    return null;
  }
  if (narrativeLower.includes("compared with the month before")) {
    return null;
  }
  const priorExploratory = isExploratoryForPlays(prior.unique_artist_count, prior.play_count);
  if (exploratory && !priorExploratory && meaningfulRatioChange(artists, Math.max(1, prior.unique_artist_count))) {
    return {
      tagKey: inferModuleTagKey("COMPARED WITH BEFORE"),
      tag: "COMPARED WITH BEFORE",
      value: "More names in play",
      meta: "You were more exploratory than the month before, with less clustering around the same few artists.",
    };
  }
  if (meaningfulRatioChange(plays, prior.play_count)) {
    const up = plays > prior.play_count;
    return {
      tagKey: inferModuleTagKey("COMPARED WITH BEFORE"),
      tag: "COMPARED WITH BEFORE",
      value: up ? "Picked up steam" : "Eased back",
      meta: up
        ? "This month carried more listening than the stretch right before it."
        : "This month settles compared with the one immediately before it.",
    };
  }
  return null;
}

function buildAtTheCenterModule(input: Readonly<{
  plays: number;
  topArtist: string | null;
  dominantShare: number;
  narrativeLower: string;
}>): TimeMachineModule | null {
  const { plays, topArtist, dominantShare, narrativeLower } = input;
  if (!topArtist || plays < 1) {
    return null;
  }
  const tp = narrativeLower.includes(topArtist.toLowerCase());
  const strongEnough =
    dominantShare >= 0.2 ||
    (dominantShare >= 0.14 && plays >= MIN_PLAYS_WEAK);
  if (!strongEnough) {
    return null;
  }
  if (dominantShare >= 0.38 && tp && narrativeLower.includes("centered strongly")) {
    return null;
  }
  return {
    tagKey: inferModuleTagKey("AT THE CENTER"),
    tag: "AT THE CENTER",
    value: topArtist,
    meta:
      dominantShare >= 0.32
        ? "The steadiest recurring name through this stretch."
        : "Still the clearest thread even without running the whole month.",
  };
}

function buildWhatStuckModule(input: Readonly<{
  plays: number;
  replayHeavy: boolean;
  topTrack: string | null;
  topArtist: string | null;
  narrativeLower: string;
}>): TimeMachineModule | null {
  const { plays, replayHeavy, topTrack, topArtist, narrativeLower } = input;
  if (plays < 1) {
    return null;
  }
  if (replayHeavy) {
    if (narrativeLower.includes("replay-heavy") || narrativeLower.includes("same tracks")) {
      return {
        tagKey: inferModuleTagKey("WHAT STUCK"),
        tag: "WHAT STUCK",
        value: "Familiar loops",
        meta: "Comfort listening more than constant novelty.",
      };
    }
    return {
      tagKey: inferModuleTagKey("WHAT STUCK"),
      tag: "WHAT STUCK",
      value: "Familiar loops",
      meta: "The same few tracks kept resurfacing in your rotation.",
    };
  }
  if (topTrack && topArtist && plays >= MIN_PLAYS_WEAK) {
    const line = `${topTrack}`.toLowerCase();
    if (narrativeLower.includes(line) && narrativeLower.includes(topArtist.toLowerCase())) {
      return {
        tagKey: inferModuleTagKey("WHAT STUCK"),
        tag: "WHAT STUCK",
        value: topTrack,
        meta: `Kept returning with ${topArtist} in the frame.`,
      };
    }
    return {
      tagKey: inferModuleTagKey("WHAT STUCK"),
      tag: "WHAT STUCK",
      value: topTrack,
      meta: `Often enough to feel tied to ${topArtist} this month.`,
    };
  }
  return null;
}

function buildListeningShapeModule(input: Readonly<{
  plays: number;
  artists: number;
  tracks: number;
  exploratory: boolean;
  replayHeavy: boolean;
  narrativeLower: string;
}>): TimeMachineModule {
  const { plays, artists, tracks, exploratory, replayHeavy, narrativeLower } = input;
  if (plays < MIN_PLAYS_WEAK) {
    return {
      tagKey: inferModuleTagKey("LISTENING SHAPE"),
      tag: "LISTENING SHAPE",
      value: "A light footprint",
      meta: "Only a handful of plays landed in this slice, so the shape stays soft.",
    };
  }
  if (replayHeavy && !narrativeLower.includes("replay-heavy") && !narrativeLower.includes("same tracks")) {
    return {
      tagKey: inferModuleTagKey("LISTENING SHAPE"),
      tag: "LISTENING SHAPE",
      value: "Repeat-forward",
      meta: "Familiar tracks did more of the work than one-off novelty spins.",
    };
  }
  if (exploratory && !narrativeLower.includes("not locked into one voice")) {
    return {
      tagKey: inferModuleTagKey("LISTENING SHAPE"),
      tag: "LISTENING SHAPE",
      value: "Wide rotation",
      meta: "More artists in the mix than a tight, single-focus month tends to show.",
    };
  }
  if (tracks > 0 && artists > 0) {
    return {
      tagKey: inferModuleTagKey("LISTENING SHAPE"),
      tag: "LISTENING SHAPE",
      value: "Balanced spread",
      meta: "Time moved between artists and returning titles without one extreme winning out.",
    };
  }
  return {
    tagKey: inferModuleTagKey("LISTENING SHAPE"),
    tag: "LISTENING SHAPE",
    value: "Steady cadence",
    meta: "Listening stayed active without a sharp edge case dominating the calendar.",
  };
}

function buildPeriodIntensityModule(input: Readonly<{
  plays: number;
  prior: TimeMachineMonthMetricsRow | null;
  narrativeLower: string;
}>): TimeMachineModule | null {
  const { plays, prior, narrativeLower } = input;
  if (!isPriorComparableForContrast(prior, plays)) {
    return null;
  }
  if (!meaningfulRatioChange(plays, prior.play_count)) {
    return null;
  }
  if (narrativeLower.includes("noticeably more listening") || narrativeLower.includes("energy eases")) {
    return null;
  }
  const up = plays > prior.play_count;
  return {
    tagKey: inferModuleTagKey("PERIOD INTENSITY"),
    tag: "PERIOD INTENSITY",
    value: up ? "Heavier month" : "Quieter month",
    meta: up
      ? "More plays stacked up here than in the prior stretch."
      : "Fewer plays overall than the month before this one.",
  };
}

function takeDistinct(
  out: TimeMachineModule[],
  used: Set<string>,
  mod: TimeMachineModule | null,
): void {
  if (mod === null || used.has(mod.tag)) {
    return;
  }
  used.add(mod.tag);
  out.push(mod);
}

/**
 * Always returns three cards when `plays >= 1` (empty month stays empty).
 */
function buildSupportModules(input: Readonly<{
  plays: number;
  artists: number;
  tracks: number;
  topArtist: string | null;
  topTrack: string | null;
  dominantShare: number;
  exploratory: boolean;
  replayHeavy: boolean;
  prior: TimeMachineMonthMetricsRow | null;
  newArtistsRanked: readonly TimeMachineNewArtistInPeriod[];
  newArtistTotalCount: number;
  narrativeLower: string;
}>): TimeMachineModule[] {
  const {
    plays,
    artists,
    tracks,
    topArtist,
    topTrack,
    dominantShare,
    exploratory,
    replayHeavy,
    prior,
    newArtistsRanked,
    newArtistTotalCount,
    narrativeLower,
  } = input;

  const newHere = buildNewAroundHereModule({
    newArtistsRanked,
    newArtistTotalCount,
    narrativeLower,
  });
  const shape = buildListeningShapeModule({
    plays,
    artists,
    tracks,
    exploratory,
    replayHeavy,
    narrativeLower,
  });
  const compared = buildComparedWithBeforeModule({
    plays,
    artists,
    exploratory,
    prior,
    narrativeLower,
  });
  const center = buildAtTheCenterModule({ plays, topArtist, dominantShare, narrativeLower });
  const stuck = buildWhatStuckModule({ plays, replayHeavy, topTrack, topArtist, narrativeLower });
  const intensity = buildPeriodIntensityModule({ plays, prior, narrativeLower });

  const pool: TimeMachineModule[] = [
    newHere,
    shape,
    compared,
    center,
    stuck,
    intensity,
  ].filter((m): m is TimeMachineModule => m !== null);

  const out: TimeMachineModule[] = [];
  const used = new Set<string>();

  const noveltyFirst =
    newHere ??
    stuck ??
    compared ??
    center ??
    {
      tagKey: inferModuleTagKey("WHAT STUCK"),
      tag: "WHAT STUCK",
      value: topTrack && topArtist ? topTrack : "Small sample",
      meta:
        topTrack && topArtist
          ? `A recurring title alongside ${topArtist} in this slice.`
          : "Not enough signal for a strong novelty read — this card holds a concrete thread instead.",
    };

  takeDistinct(out, used, noveltyFirst);
  takeDistinct(out, used, shape);

  const restPriority: TimeMachineModule[] = [compared, center, stuck, intensity, newHere].filter(
    (m): m is TimeMachineModule => m !== null,
  );
  for (const m of restPriority) {
    if (out.length >= 3) {
      break;
    }
    takeDistinct(out, used, m);
  }

  for (const m of pool) {
    if (out.length >= 3) {
      break;
    }
    takeDistinct(out, used, m);
  }

  const emergency: TimeMachineModule[] = [];
  if (topArtist) {
    emergency.push({
      tagKey: inferModuleTagKey("AT THE CENTER"),
      tag: "AT THE CENTER",
      value: topArtist,
      meta: "The clearest name to hold onto when everything else is in motion.",
    });
  }
  emergency.push({
    tagKey: inferModuleTagKey("THIS PERIOD"),
    tag: "THIS PERIOD",
    value: `${plays.toLocaleString("en-US")} plays`,
    meta: "A simple anchor while the rest of the picture stays diffuse.",
  });
  emergency.push({
    tagKey: inferModuleTagKey("LISTENING SHAPE"),
    tag: "LISTENING SHAPE",
    value: "Steady cadence",
    meta: "Listening stayed active without a sharp edge case dominating the calendar.",
  });
  for (const m of emergency) {
    if (out.length >= 3) {
      break;
    }
    takeDistinct(out, used, m);
  }

  return out.slice(0, 3).map(
    (m): TimeMachineModule => ({
      tagKey: inferModuleTagKey(m.tag),
      tag: m.tag,
      value: m.value,
      meta: m.meta,
    }),
  );
}

/**
 * Builds editorial copy for the Musical Time Machine explore surface.
 * Omits comparative claims when evidence is thin.
 */
export function buildTimeMachineExploreCopy(input: Readonly<{
  monthYyyMm: string;
  metrics: TimeMachineMonthMetricsRow | null;
  prior: TimeMachineMonthMetricsRow | null;
  sameMonthPriorYear?: TimeMachineMonthMetricsRow | null;
  yearMetrics?: TimeMachineMonthMetricsRow | null;
  newArtistCount: number;
  newArtistsRanked?: readonly TimeMachineNewArtistInPeriod[];
  timeline?: readonly TimeMachineMonthDensityRow[];
  nextMonth?: TimeMachineMonthMetricsRow | null;
  exploreCharts?: Readonly<{
    topTracks: readonly TimeMachineExploreAnchorTrackRow[];
    topAlbums: readonly TimeMachineExploreAnchorAlbumRow[];
  }> | null;
  archivePath?: string;
}>): TimeMachineExploreCopy {
  const {
    monthYyyMm,
    metrics,
    prior,
    sameMonthPriorYear = null,
    yearMetrics = null,
    newArtistCount,
    newArtistsRanked = [],
    timeline = [],
    nextMonth = null,
    exploreCharts = null,
    archivePath = "/dashboard/archive",
  } = input;
  const periodLabel = formatUtcMonthLong(monthYyyMm);

  if (metrics === null || metrics.play_count < 1) {
    const emptyPrimaryText =
      "There is no listening in this slice of your archive. Scrub to another month, or check that your import covers this stretch.";
    return {
      periodLabel,
      summaryLine: "No plays this month.",
      contextStrip: [],
      primaryNarrative: { runs: [{ type: "plain", text: emptyPrimaryText }] },
      comparisonNarrative: null,
      continuityNarrative: null,
      detailLines: [],
      modules: [],
    };
  }

  const plays = metrics.play_count;
  const artists = metrics.unique_artist_count;
  const tracks = metrics.unique_track_count;
  const albums = metrics.unique_album_count;
  const topArtist = safeName(metrics.top_artist_name);
  const topTrack = safeName(metrics.top_track_title);
  const dominantShare = dominantArtistShare(metrics, plays);
  const exploratory = isExploratoryForPlays(artists, plays);
  const replayRatio = tracks > 0 ? Math.max(0, (plays - tracks) / Math.max(1, tracks)) : 0;
  const replayHeavy = replayRatio >= 1.2;

  const summaryLine = pickSummaryLine({
    plays,
    artists,
    dominantShare,
    topArtist,
    replayHeavy,
    exploratory,
    prior,
    newArtistCount,
  });

  const statParts: string[] = [`${plays.toLocaleString("en-US")} plays`];
  if (artists > 0) {
    statParts.push(`${artists.toLocaleString("en-US")} artists`);
  }
  if (tracks > 0) {
    statParts.push(`${tracks.toLocaleString("en-US")} tracks`);
  }
  if (albums > 0) {
    statParts.push(`${albums.toLocaleString("en-US")} albums`);
  }
  const compactStatLine = statParts.join(" · ");

  const contextStrip = buildContextStripLines({
    monthYyyMm,
    plays,
    artists,
    tracks,
    timeline,
  });

  let primaryText = buildPrimaryExpansion({
    plays,
    artists,
    tracks,
    topArtist,
    topTrack,
    dominantShare,
    exploratory,
    replayHeavy,
    newArtistCount,
  });
  primaryText = ensureConcreteMusicInPrimaryNarrative(primaryText, topTrack, topArtist);

  const comparisonText = buildComparisonNatural({
    plays,
    artists,
    tracks,
    topArtist,
    topTrack,
    exploratory,
    replayHeavy,
    prior,
  });

  const continuityText = buildContinuityNatural({
    monthYyyMm,
    plays,
    topArtist,
    sameMonthPriorYear,
    timeline,
    nextMonth,
    newArtistCount,
  });

  const detailLines = buildDetailLines({
    monthYyyMm,
    plays,
    compactStatLine,
    yearMetrics,
    sameMonthPriorYear,
  });

  const narrativeLower = [primaryText, comparisonText, continuityText]
    .filter((s): s is string => Boolean(s && s.trim().length > 0))
    .join(" ")
    .toLowerCase();

  const modulesBase = buildSupportModules({
    plays,
    artists,
    tracks,
    topArtist,
    topTrack,
    dominantShare,
    exploratory,
    replayHeavy,
    prior,
    newArtistsRanked,
    newArtistTotalCount: newArtistCount,
    narrativeLower,
  });

  const rankedHeadNew = rankNewArtistsForCard(newArtistsRanked)[0]?.name ?? null;
  const topAlbumTitle =
    exploreCharts?.topAlbums[0]?.title !== undefined
      ? safeName(exploreCharts.topAlbums[0].title)
      : null;
  const entityCandidates = entityCandidatesForExploreMonth({
    monthYyyMm,
    topArtist,
    topTrack,
    topAlbumTitle,
    newArtistHeadline: rankedHeadNew,
    archivePath,
  });

  const hasCharts =
    exploreCharts !== null && (exploreCharts.topTracks.length > 0 || exploreCharts.topAlbums.length > 0);
  const modules = hasCharts
    ? applySingleExploreCardArt(modulesBase, {
        topTracks: exploreCharts!.topTracks,
        topAlbums: exploreCharts!.topAlbums,
        topTrackTitle: topTrack,
        topArtistName: topArtist,
      })
    : modulesBase;

  return {
    periodLabel,
    summaryLine,
    contextStrip,
    primaryNarrative: buildExploreNarrativeParagraph(primaryText, entityCandidates),
    comparisonNarrative: comparisonText
      ? buildExploreNarrativeParagraph(comparisonText, entityCandidates)
      : null,
    continuityNarrative: continuityText
      ? buildExploreNarrativeParagraph(continuityText, entityCandidates)
      : null,
    detailLines,
    modules,
  };
}
