import type { DashboardHeroWindowMetrics, DashboardListenSummary } from "@vs/db";
import {
  displayUtcWeekdayPeak,
  inWindowBehaviorInsight,
} from "@/app/dashboard/dashboard-window-behavior";
import {
  addCalendarDaysYmd,
  calendarYesterdayYmd,
  isFridayInTimeZone,
  monthDayLongInTimeZone,
  weekdayLongForYmdAtNoonUtc,
  weekdayLongInTimeZone,
} from "@/server/dashboard-home-briefing-calendar";

/**
 * ## Home briefing builder (narrative + secondary rows)
 *
 * **Intent:** Choose what is worth saying about the rolling window — significance, contrast,
 * continuity, memory, specificity — not every available fact. Prefer a shorter, stronger read
 * over filler; reject weak comparisons, repeated numbers, and stats-page tone.
 *
 * **Structure:** Weekday: greeting → daily narrative → secondary insights → optional yesterday
 * block → support cards → actions. Friday: greeting → weekly narrative → secondary insights →
 * yesterday snapshot (when shown) → support cards → actions.
 *
 * **Narrative:** Up to three short paragraphs (fewer when signals are weak). Paragraph 1 frames
 * what defined the period (activity + standout). Paragraph 2 adds change vs prior window,
 * repeat vs exploration, timing/shape, or a meaningful anomaly. Paragraph 3 is optional and
 * reserved for continuity, novelty, streak, or year-ago — only when strong.
 *
 * **Secondary insights:** Cap at three rows before yesterday. Tags in use include `SHIFT`,
 * `A YEAR AGO`, `CONTINUITY`, `RETURN`, `SHAPE`, `FOCUS`, `WORTH NOTING`, `MOMENT`. Prefer
 * human labels over volume-only rows. Year-ago is premium space: only when validation passes and
 * copy stays interpretive (avoid giant raw counts and awkward arithmetic). Yesterday snapshot:
 * one to two sentences, supportive “week then day” handoff on Friday; no repeating exact totals
 * already stated elsewhere.
 *
 * **Thresholds & suppression:** Treat week-over-week and day-over-day shifts as meaningful only
 * when absolute deltas and {@link meaningfulWeeklyDelta} / {@link meaningfulDailyDelta} agree
 * (including the ~15% relative swing rule). Once the narrative states a fact, do not restate it
 * in secondary rows (see {@link pushInsight} narrative de-dupe). If `SHIFT` already carries the
 * comparison, avoid cards or other rows that repeat the same delta language or numbers.
 *
 * ## Support cards (secondary to the story)
 *
 * **Intent:** Cards answer “what is helpful after reading the briefing?” — not “what other stats
 * exist?” They should feel quiet and supportive; avoid a mini KPI wall or three ranking tiles in a
 * row.
 *
 * **Count:** Prefer three cards on home; allow a fourth on desktop only when it adds a clearly
 * different angle; never pad with weak cards — two strong cards beat three bland ones.
 *
 * **Roles (mix):** Usually one **anchor** (top artist, top track, listening time, top album),
 * one **behavior** (listening time, peak day, peak daypart, focus vs exploratory), and one
 * **novelty** or **continuity** (new artists, returning artist, streak). Listening time, peak
 * day/daypart, meaningful new artists, strong returns, streaks, and focus/exploration (when
 * strong) outrank redundant top-artist or raw play-count cards.
 *
 * **Suppression:** Do not restate the narrative’s main claim; do not repeat the same number twice;
 * do not duplicate `SHIFT`-style comparison copy on a card. If the story already centered top
 * artist, prefer other angles unless one anchor card is still needed for scanability.
 *
 * **Copy:** Each card: label, primary value, one short supporting line — factual and calm.
 *
 * When changing this module, keep narrative, secondary rows, yesterday, and cards mutually
 * non-redundant and bias interpretation over raw reporting.
 */

export type DashboardHomeBriefingCard = Readonly<{
  kicker: string;
  title: string;
  detail: string | null;
}>;

export type DashboardHomeBriefingAction = Readonly<{
  href: string;
  label: string;
}>;

/** Inline pieces inside one narrative paragraph; `accent` uses product orange. */
export type DashboardHomeNarrativeSegment = Readonly<
  { kind: "plain"; text: string } | { kind: "accent"; text: string }
>;

export type DashboardHomeSecondaryInsight = Readonly<{
  tag: string;
  sentence: string;
}>;

export type DashboardHomeBriefing = Readonly<{
  scope: "daily" | "weekly";
  greetingLine1: string;
  dateHeadline: string;
  calendarFootnote: string;
  narrativeParagraphs: readonly (readonly DashboardHomeNarrativeSegment[])[];
  secondaryInsights: readonly DashboardHomeSecondaryInsight[];
  yesterdaySnapshot: Readonly<{ body: string }> | null;
  cards: readonly DashboardHomeBriefingCard[];
  actions: readonly DashboardHomeBriefingAction[];
}>;

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

export function parseDashboardHomeBriefingFromJson(raw: unknown): DashboardHomeBriefing | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.scope !== "daily" && raw.scope !== "weekly") {
    return null;
  }
  if (typeof raw.greetingLine1 !== "string" || typeof raw.dateHeadline !== "string") {
    return null;
  }
  if (typeof raw.calendarFootnote !== "string") {
    return null;
  }
  if (!Array.isArray(raw.narrativeParagraphs) || !Array.isArray(raw.secondaryInsights)) {
    return null;
  }
  if (!Array.isArray(raw.cards) || !Array.isArray(raw.actions)) {
    return null;
  }
  if (raw.yesterdaySnapshot !== null && typeof raw.yesterdaySnapshot !== "object") {
    return null;
  }
  return raw as unknown as DashboardHomeBriefing;
}

function timelinePlaysForYmd(
  timeline: readonly { period_start: string; count: number }[],
  ymd: string,
): number {
  const hit = timeline.find((p) => p.period_start === ymd);
  return hit?.count ?? 0;
}

export function isFridayUtc(nowMs: number): boolean {
  return isFridayInTimeZone(nowMs, "UTC");
}

/** First token of display name, or null when missing — caller picks fallback copy. */
export function greetingFirstName(displayName: string | null | undefined): string | null {
  if (displayName == null) {
    return null;
  }
  const t = displayName.trim();
  if (t.length === 0) {
    return null;
  }
  const first = t.split(/\s+/)[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function formatBriefingCalendarHeadingUtc(nowMs: number): string {
  return monthDayLongInTimeZone(nowMs, "UTC");
}

function formatCountWord(n: number, noun: "track" | "play"): string {
  const w = noun === "track" ? "track" : "play";
  const plural = n === 1 ? w : `${w}s`;
  return `${n} ${plural}`;
}

function meaningfulDailyDelta(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < 10) {
    return false;
  }
  const pct = (diff / Math.max(b, 1)) * 100;
  return pct >= 15;
}

function meaningfulWeeklyDelta(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < 40) {
    return false;
  }
  const pct = (diff / Math.max(b, 1)) * 100;
  return pct >= 15;
}

/** Above this, 7-day totals are treated as untrustworthy for prose (mis-anchored rollups, etc.). */
function plausibleSevenDayScrobbleTotal(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 4000;
}

function weeklyListeningOpeningClause(total: number): string {
  if (total >= 200) {
    return "You spent a lot of time listening this week";
  }
  if (total >= 95) {
    return "You logged a strong week of listening";
  }
  if (total >= 45) {
    return "You had a solid week of plays";
  }
  if (total >= 18) {
    return "Listening was on the quieter side, but still steady, this week";
  }
  return "Listening was light this week";
}

/** Phrase after "with …" in the weekly opening sentence (gerund-led, reads aloud). */
function weeklyTopArtistFocusFragment(
  topArtist: DashboardListenSummary["top_artists"][0],
  summary: DashboardListenSummary,
): string {
  const t = summary.total_scrobbles;
  const share = t > 0 ? topArtist.plays / t : 0;
  const runner = summary.top_artists[1];
  const tightRace =
    runner != null && runner.plays > 0 && topArtist.plays / runner.plays < 1.25;
  if (share >= 0.42) {
    return `${topArtist.name} carrying most of what you played`;
  }
  if (tightRace) {
    return `${topArtist.name} edging ahead as the name you kept returning to`;
  }
  if (share >= 0.2) {
    return `${topArtist.name} showing up more than anything else`;
  }
  return `${topArtist.name} anchoring the week's rotation`;
}

function dateHeadlineForScope(
  nowMs: number,
  scope: "daily" | "weekly",
  calendarTimeZone: string,
): string {
  const monthDay = monthDayLongInTimeZone(nowMs, calendarTimeZone);
  if (scope === "weekly") {
    return `Here's your week in music for Friday, ${monthDay}.`;
  }
  const weekday = weekdayLongInTimeZone(nowMs, calendarTimeZone);
  return `Here's your update for ${weekday}, ${monthDay}.`;
}

function firstSentenceToNarrativeSegments(line: string): readonly DashboardHomeNarrativeSegment[] {
  const re = /^You listened to (\d+ tracks?) yesterday\. (.*)$/;
  const m = line.match(re);
  if (!m) {
    return [{ kind: "plain", text: line }];
  }
  const [, countAndNoun, rest] = m;
  return [
    { kind: "plain", text: "You listened to " },
    { kind: "accent", text: `${countAndNoun} yesterday` },
    { kind: "plain", text: `. ${rest}` },
  ];
}

function lineToParagraph(line: string, isFirst: boolean): readonly DashboardHomeNarrativeSegment[] {
  if (isFirst) {
    return firstSentenceToNarrativeSegments(line);
  }
  return [{ kind: "plain", text: line }];
}

function linesToNarrativeParagraphs(lines: readonly string[]): readonly (readonly DashboardHomeNarrativeSegment[])[] {
  const capped = lines.slice(0, 3);
  return capped.map((line, i) => lineToParagraph(line, i === 0));
}

function narrativePlainText(paragraphs: readonly (readonly DashboardHomeNarrativeSegment[])[]): string {
  return paragraphs.flatMap((p) => p.map((s) => s.text)).join("");
}

function pushInsight(
  out: DashboardHomeSecondaryInsight[],
  tag: string,
  sentence: string,
  narrativeText: string,
) {
  if (out.length >= 3) {
    return;
  }
  if (sentence.length === 0) {
    return;
  }
  if (narrativeText.includes(sentence)) {
    return;
  }
  out.push({ tag, sentence });
}

function topThreeArtistShare(summary: DashboardListenSummary): number {
  const t = summary.total_scrobbles;
  if (t < 1) {
    return 0;
  }
  let s = 0;
  for (const a of summary.top_artists.slice(0, 3)) {
    s += a.plays;
  }
  return s / t;
}

function comfortExplorationSentence(summary: DashboardListenSummary): string | null {
  const share = topThreeArtistShare(summary);
  if (share >= 0.74) {
    return "You were more focused this week — fewer artists, more repeat listening.";
  }
  if (share <= 0.38 && summary.top_artists.length >= 5) {
    return "You moved between more artists than usual — the week had a more exploratory shape.";
  }
  return null;
}

function focusExplorationSupportCard(summary: DashboardListenSummary): DashboardHomeBriefingCard | null {
  const share = topThreeArtistShare(summary);
  if (share >= 0.74) {
    return {
      kicker: "This stretch",
      title: "More focused",
      detail: "Fewer artists, more repeats",
    };
  }
  if (share <= 0.38 && summary.top_artists.length >= 5) {
    return {
      kicker: "This stretch",
      title: "More exploratory",
      detail: "A wider rotation than usual",
    };
  }
  return null;
}

function briefingCorpus(
  narrativeText: string,
  secondaryInsights: readonly DashboardHomeSecondaryInsight[],
): string {
  return `${narrativeText} ${secondaryInsights.map((s) => s.sentence).join(" ")}`;
}

/** True when the narrative already treats this artist as the period’s center — suppress redundant anchor cards. */
function narrativeCentersTopArtist(narrative: string, artistName: string | null | undefined): boolean {
  if (artistName == null || artistName.length === 0) {
    return false;
  }
  if (!narrative.includes(artistName)) {
    return false;
  }
  const lower = narrative.toLowerCase();
  const needle = artistName.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) {
    return false;
  }
  const windowSlice = lower.slice(Math.max(0, idx - 80), Math.min(lower.length, idx + needle.length + 100));
  const hooks = [
    "carried most",
    "carrying most",
    "carrying your listening",
    "showing up more than anything",
    "showing up more than anything else",
    "anchoring the week's rotation",
    "edging ahead as the name",
    "leaned on",
  ];
  return hooks.some((h) => windowSlice.includes(h));
}

function peakCoveredInNarrative(narrative: string, peakName: string | null): boolean {
  if (peakName == null || peakName.length === 0 || peakName === "—") {
    return false;
  }
  if (!narrative.includes(peakName)) {
    return false;
  }
  const lower = narrative.toLowerCase();
  // Only suppress when the weekly narrative already burned the same “clustered on …” beat as the card.
  return lower.includes("clustered on") || lower.includes("much of that activity clustered");
}

function parseReturnAfterGapArtist(sentence: string | null): string | null {
  if (sentence == null || sentence.length === 0) {
    return null;
  }
  const m = sentence.match(/^You came back to (.+?) after about /);
  const name = m?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}

function corpusMentionsReturnStory(corpus: string): boolean {
  return corpus.toLowerCase().includes("came back to");
}

function corpusMentionsStreak(corpus: string): boolean {
  const lower = corpus.toLowerCase();
  return (
    lower.includes("steady streak") ||
    lower.includes("every day in this stretch") ||
    lower.includes("listened on each of the last") ||
    /\bstreak\b/.test(lower)
  );
}

function comfortExplorationInCorpus(corpus: string, comfortLine: string | null): boolean {
  if (comfortLine == null) {
    return false;
  }
  if (corpus.includes(comfortLine)) {
    return true;
  }
  return (
    corpus.toLowerCase().includes("more focused") ||
    corpus.toLowerCase().includes("more exploratory") ||
    corpus.toLowerCase().includes("exploratory shape") ||
    corpus.toLowerCase().includes("fewer artists, more repeat")
  );
}

function isRankingSupportCard(card: DashboardHomeBriefingCard): boolean {
  const k = card.kicker.toLowerCase();
  return (
    k.includes("top artist") ||
    k === "most replayed" ||
    k.includes("top album") ||
    k.includes("album in rotation")
  );
}

/**
 * Support cards run after narrative + secondary rows; at most one ranking-style anchor
 * (top artist / top track / top album), plus behavior and continuity angles per product spec.
 */
function buildSupportCards(input: Readonly<{
  friday: boolean;
  narrativeText: string;
  secondaryInsights: readonly DashboardHomeSecondaryInsight[];
  total: number;
  summary: DashboardListenSummary;
  topArtist: DashboardListenSummary["top_artists"][0] | undefined;
  topTrack: DashboardListenSummary["top_tracks"][0] | undefined;
  topAlbum: DashboardListenSummary["top_albums"][0] | undefined;
  peakForNarrative: ReturnType<typeof displayUtcWeekdayPeak>;
  comfortLine: string | null;
  listeningStreakDays: number;
  returnAfterGapSentence: string | null;
}>): readonly DashboardHomeBriefingCard[] {
  const {
    friday,
    narrativeText,
    secondaryInsights,
    total,
    summary,
    topArtist,
    topTrack,
    topAlbum,
    peakForNarrative,
    comfortLine,
    listeningStreakDays,
    returnAfterGapSentence,
  } = input;

  const corpus = briefingCorpus(narrativeText, secondaryInsights);
  const signalWeak =
    total < 20 || (topArtist?.plays ?? 0) < 5 || (topArtist != null && total > 0 && topArtist.plays / total < 0.12);
  const maxCards = signalWeak ? 2 : 3;

  const peakLabel = peakForNarrative?.name ?? "—";
  const peakDetail =
    peakForNarrative && peakForNarrative.count > 0
      ? friday
        ? `Most activity landed on ${peakLabel}s in this window`
        : `${peakForNarrative.count} plays on that weekday in this window`
      : null;

  const peakCard: DashboardHomeBriefingCard | null =
    peakForNarrative && peakForNarrative.count > 0 && peakDetail
      ? { kicker: "Peak day", title: peakLabel, detail: peakDetail }
      : null;

  const suppressPeak = peakCard == null || peakCoveredInNarrative(narrativeText, peakLabel);
  const suppressFocusCard = comfortExplorationInCorpus(corpus, comfortLine);
  const focusCard = suppressFocusCard ? null : focusExplorationSupportCard(summary);

  const returnArtist = parseReturnAfterGapArtist(returnAfterGapSentence);
  const suppressReturnCard =
    returnArtist == null || corpusMentionsReturnStory(corpus) || narrativeText.includes(returnArtist);

  const returnCard: DashboardHomeBriefingCard | null =
    !suppressReturnCard && returnArtist
      ? {
          kicker: "Back in rotation",
          title: returnArtist,
          detail: "First meaningful return after a stretch away",
        }
      : null;

  const suppressStreakCard = corpusMentionsStreak(corpus) || listeningStreakDays < 4;
  const streakCard: DashboardHomeBriefingCard | null =
    !suppressStreakCard
      ? {
          kicker: "Current streak",
          title: `${listeningStreakDays} straight days`,
          detail:
            listeningStreakDays >= 7
              ? "You listened every day in this rolling window"
              : "Listening stayed steady day to day",
        }
      : null;

  const centersArtist = narrativeCentersTopArtist(narrativeText, topArtist?.name);
  const trackShare = topTrack && total > 0 ? topTrack.plays / total : 0;
  const minTrackShareForAnchor = friday ? 0.03 : 0.08;
  const strongTrack =
    topTrack != null &&
    topTrack.plays >= 3 &&
    trackShare >= minTrackShareForAnchor &&
    !narrativeText.includes(topTrack.title) &&
    !corpus.includes(topTrack.title);

  const trackAnchor: DashboardHomeBriefingCard | null =
    strongTrack
      ? {
          kicker: "Most replayed",
          title: topTrack.title,
          detail: `${topTrack.artist_name} · ${topTrack.plays} plays`,
        }
      : null;

  const artistAnchor: DashboardHomeBriefingCard | null =
    topArtist && topArtist.plays > 0 && !centersArtist
      ? {
          kicker: friday ? "Top artist this week" : "Top artist",
          title: topArtist.name,
          detail: `${topArtist.plays} plays in this window`,
        }
      : null;

  const albumAnchor: DashboardHomeBriefingCard | null =
    topAlbum &&
    topAlbum.plays >= 3 &&
    !narrativeText.includes(topAlbum.title) &&
    !corpus.includes(topAlbum.title)
      ? {
          kicker: friday ? "Top album" : "Album in rotation",
          title: topAlbum.title,
          detail: `${topAlbum.artist_name} · ${topAlbum.plays} plays`,
        }
      : null;

  let anchor: DashboardHomeBriefingCard | null = null;
  if (trackAnchor) {
    anchor = trackAnchor;
  } else if (artistAnchor) {
    anchor = artistAnchor;
  } else if (albumAnchor) {
    anchor = albumAnchor;
  }

  let behavior: DashboardHomeBriefingCard | null = null;
  if (!suppressPeak && peakCard) {
    behavior = peakCard;
  } else if (focusCard) {
    behavior = focusCard;
  }

  let novelty: DashboardHomeBriefingCard | null = null;
  if (returnCard) {
    novelty = returnCard;
  } else if (streakCard) {
    novelty = streakCard;
  }

  if (friday && behavior == null && peakCard && !suppressPeak) {
    behavior = peakCard;
  }

  const ordered: DashboardHomeBriefingCard[] = [];
  const pushUnique = (c: DashboardHomeBriefingCard | null) => {
    if (c == null) {
      return;
    }
    if (ordered.some((x) => x.kicker === c.kicker && x.title === c.title)) {
      return;
    }
    ordered.push(c);
  };

  pushUnique(anchor);
  pushUnique(behavior);
  pushUnique(novelty);

  let rankingUsed = ordered.some(isRankingSupportCard);

  const fillThird = () => {
    if (ordered.length >= maxCards) {
      return;
    }
    const tryPush = (c: DashboardHomeBriefingCard | null) => {
      if (c == null || ordered.length >= maxCards) {
        return;
      }
      if (isRankingSupportCard(c) && rankingUsed) {
        return;
      }
      pushUnique(c);
      if (isRankingSupportCard(c)) {
        rankingUsed = true;
      }
    };
    tryPush(!suppressPeak && peakCard ? peakCard : null);
    tryPush(focusCard);
    tryPush(trackAnchor && anchor?.kicker !== trackAnchor.kicker ? trackAnchor : null);
    tryPush(artistAnchor && anchor?.kicker !== artistAnchor.kicker ? artistAnchor : null);
    tryPush(albumAnchor && anchor?.kicker !== albumAnchor.kicker ? albumAnchor : null);
    tryPush(streakCard && ordered.every((x) => x.kicker !== streakCard.kicker) ? streakCard : null);
    tryPush(returnCard && ordered.every((x) => x.kicker !== returnCard.kicker) ? returnCard : null);
  };

  fillThird();

  if (ordered.length < maxCards) {
    fillThird();
  }

  if (ordered.length === 0 && topArtist && topArtist.plays > 0) {
    ordered.push({
      kicker: friday ? "Top artist this week" : "Top artist",
      title: topArtist.name,
      detail: `${topArtist.plays} plays in this window`,
    });
    rankingUsed = true;
  }

  if (ordered.length === 0) {
    return [
      { kicker: "Top artist", title: "—", detail: "Nothing to rank in this window yet" },
      { kicker: "Peak day", title: "—", detail: null },
    ];
  }

  if (ordered.length === 1 && maxCards >= 2) {
    const c2 =
      (!suppressPeak && peakCard && peakCard.title !== ordered[0]?.title ? peakCard : null) ??
      focusCard ??
      (trackAnchor && !rankingUsed ? trackAnchor : null) ??
      (artistAnchor && !rankingUsed ? artistAnchor : null);
    if (c2) {
      pushUnique(c2);
    }
  }

  return ordered.slice(0, maxCards);
}

function consecutiveListeningDaysEndingOnYmd(
  timeline: readonly { period_start: string; count: number }[],
  endYmd: string,
): number {
  const map = new Map(timeline.map((t) => [t.period_start, t.count]));
  let y = endYmd;
  let streak = 0;
  for (let i = 0; i < 40; i += 1) {
    const c = map.get(y) ?? 0;
    if (c < 1) {
      break;
    }
    streak += 1;
    const prev = addCalendarDaysYmd(y, -1);
    if (!prev) {
      break;
    }
    y = prev;
  }
  return streak;
}

function pickStandoutMomentSentence(
  summary: DashboardListenSummary,
  comfort: string | null,
  behavior: string | null,
): string | null {
  if (behavior && !behavior.startsWith("Once")) {
    return behavior;
  }
  if (comfort) {
    return comfort;
  }
  const t = summary.total_scrobbles;
  if (t < 1) {
    return null;
  }
  const topPlays = summary.top_tracks[0]?.plays ?? 0;
  if (topPlays / t >= 0.1) {
    return "You kept circling back to a small set of tracks more than usual.";
  }
  const shareTop = (summary.top_artists[0]?.plays ?? 0) / t;
  if (shareTop >= 0.35) {
    return "You were more focused this week — plays kept gathering on a smaller set of artists.";
  }
  return null;
}

function buildSecondaryInsights(input: Readonly<{
  scope: "daily" | "weekly";
  narrativeText: string;
  yPlays: number;
  dPlays: number;
  total: number;
  priorTotal: number;
  priorTopName: string | null | undefined;
  topArtist: DashboardListenSummary["top_artists"][0] | undefined;
  summary: DashboardListenSummary;
  behavior: string | null;
  yearAgo: DashboardListenSummary | null;
  comfort: string | null;
  listeningStreakDays: number;
  returnAfterGapSentence: string | null;
}>): readonly DashboardHomeSecondaryInsight[] {
  const out: DashboardHomeSecondaryInsight[] = [];
  const {
    narrativeText,
    yPlays,
    dPlays,
    total,
    priorTotal,
    priorTopName,
    topArtist,
    behavior,
    scope,
    yearAgo,
    comfort,
    listeningStreakDays,
    returnAfterGapSentence,
    summary,
  } = input;

  if (returnAfterGapSentence) {
    pushInsight(out, "RETURN", returnAfterGapSentence, narrativeText);
  }

  if (scope === "weekly" && total > 0 && priorTotal > 0 && meaningfulWeeklyDelta(total, priorTotal)) {
    const quieter = total < priorTotal;
    const sameLeaning =
      topArtist != null &&
      priorTopName != null &&
      priorTopName.length > 0 &&
      priorTopName === topArtist.name;
    pushInsight(
      out,
      "SHIFT",
      quieter
        ? sameLeaning
          ? "Compared with the week before, this stretch feels more restrained, even though the same artists are still carrying a lot of your time."
          : "Compared with the previous week, this stretch feels more restrained — fewer spikes, less jumping between artists."
        : "Compared with the week before, this stretch picked up more energy day to day.",
      narrativeText,
    );
  }

  if (scope === "daily" && yPlays > 0 && dPlays > 0 && meaningfulDailyDelta(yPlays, dPlays)) {
    const heavier = yPlays >= dPlays;
    pushInsight(
      out,
      "SHIFT",
      heavier
        ? "Compared with the day before, yesterday felt heavier — you reached for music more often."
        : "Compared with the day before, yesterday landed softer — a calmer day overall.",
      narrativeText,
    );
  }

  const narrativeHasYearMemory =
    narrativeText.toLowerCase().includes("last year") || narrativeText.toLowerCase().includes("year ago");

  if (scope === "weekly" && yearAgo !== null && yearAgo.total_scrobbles > 0 && !narrativeHasYearMemory) {
    const yaTop = yearAgo.top_artists[0];
    const yaTotal = yearAgo.total_scrobbles;
    if (yaTop && yaTop.plays > 0) {
      let sentence: string;
      if (!plausibleSevenDayScrobbleTotal(yaTotal) || !plausibleSevenDayScrobbleTotal(total)) {
        sentence =
          "Around this time last year the same calendar window looked different — your mix has shifted since then.";
      } else {
        const yaShare = topThreeArtistShare(yearAgo);
        const curShare = topThreeArtistShare(summary);
        const leader = topArtist?.name;
        if (yaShare > curShare + 0.1) {
          sentence =
            "Around this time last year your listening looked different — you were moving between more artists instead of staying with the same few.";
        } else if (curShare > yaShare + 0.1) {
          sentence =
            "Around this time last year you spread plays across more names than this week's tighter focus.";
        } else if (leader != null && leader.length > 0 && leader === yaTop.name) {
          sentence = `${yaTop.name} was still in the mix then — they did not stand quite as tall as they do in this window.`;
        } else {
          sentence = `Around this time last year, ${yaTop.name} sat closer to center stage — who leads the week reads differently now.`;
        }
        if (
          meaningfulWeeklyDelta(total, yaTotal) &&
          plausibleSevenDayScrobbleTotal(yaTotal) &&
          plausibleSevenDayScrobbleTotal(total)
        ) {
          const dir = total >= yaTotal ? "busier" : "quieter";
          sentence = `${sentence} The same-length window feels ${dir} now than that stretch did.`;
        }
      }
      pushInsight(out, "A YEAR AGO", sentence, narrativeText);
    }
  }

  if (listeningStreakDays >= 5) {
    pushInsight(
      out,
      "CONTINUITY",
      listeningStreakDays >= 7
        ? "You listened every day in this stretch — a steady rhythm without a real drop-off."
        : `You listened on each of the last ${listeningStreakDays} days leading up to yesterday — a steady streak.`,
      narrativeText,
    );
  }

  if (comfort) {
    pushInsight(out, "SHAPE", comfort, narrativeText);
  }

  if (topArtist && topArtist.plays > 0 && total > 0) {
    const share = topArtist.plays / total;
    if (share >= 0.32) {
      const named = !narrativeText.includes(topArtist.name);
      pushInsight(
        out,
        "FOCUS",
        named
          ? `Much of this window still leans on ${topArtist.name}.`
          : "Much of this window still leans on the same few names you keep returning to.",
        narrativeText,
      );
    }
  }

  if (behavior && !behavior.startsWith("Once")) {
    pushInsight(out, "WORTH NOTING", behavior, narrativeText);
  }

  if (out.length === 0 && summary.total_scrobbles > 0) {
    const moment = pickStandoutMomentSentence(summary, comfort, behavior);
    if (moment) {
      pushInsight(out, "MOMENT", moment, narrativeText);
    }
  }

  return out;
}

function buildBriefingActions(input: Readonly<{
  scope: "daily" | "weekly";
  hasYearAgoSecondary: boolean;
}>): readonly DashboardHomeBriefingAction[] {
  const out: DashboardHomeBriefingAction[] = [];
  if (input.scope === "weekly") {
    out.push({ href: "/dashboard/archive?range=7d", label: "See this week's breakdown" });
  }
  out.push({ href: "/dashboard/explore", label: "Explore Listening History" });
  if (input.hasYearAgoSecondary) {
    out.push({ href: "/dashboard/archive", label: "Open last year's archive" });
  } else if (input.scope === "daily") {
    out.push({ href: "/dashboard/archive", label: "Browse archive" });
  } else {
    out.push({ href: "/dashboard/explore", label: "See recent listening" });
  }
  if (out.length < 3) {
    out.push({ href: "/dashboard/explore", label: "See recent listening" });
  }
  return out.slice(0, 3);
}

export type BuildDashboardHomeBriefingInput = Readonly<{
  nowMs: number;
  displayName: string | null;
  summary: DashboardListenSummary;
  heroWindow: DashboardHeroWindowMetrics;
  /** IANA zone for “today”, yesterday labels, and Friday weekly scope. */
  calendarTimeZone: string;
  /** Prior rolling 7d window ending seven days before {@link nowMs}. */
  priorWeekSummary?: DashboardListenSummary;
  /** Rolling 7d window anchored ~365d before {@link nowMs}. */
  yearAgoSummary?: DashboardListenSummary | null;
  /** Local hour (0–23) in {@link calendarTimeZone} for light context features. */
  localHour?: number;
  /** Canonical “back after a gap” line when DB-backed recency supports it. */
  returnAfterGapSentence?: string | null;
}>;

/**
 * Rule-based home briefing: 7d listen summary, optional prior/year windows, calendar-aware hero
 * timeline (via {@link BuildDashboardHomeBriefingInput.heroWindow}), bounded comparisons.
 *
 * Product rules for narrative, secondary insights, yesterday, year-ago, and support cards are
 * documented in the module comment above; extend selection and copy to stay aligned with those
 * constraints as signals grow.
 */
export function buildDashboardHomeBriefing(input: BuildDashboardHomeBriefingInput): DashboardHomeBriefing {
  const {
    nowMs,
    displayName,
    summary,
    heroWindow,
    calendarTimeZone,
    priorWeekSummary,
    yearAgoSummary,
    localHour = 12,
    returnAfterGapSentence = null,
  } = input;

  const friday = isFridayInTimeZone(nowMs, calendarTimeZone);
  const scope: "daily" | "weekly" = friday ? "weekly" : "daily";

  const first = greetingFirstName(displayName);
  const greetingLine1 =
    first != null ? `Welcome back, ${first}.` : "Welcome back.";
  const dateHeadline = dateHeadlineForScope(nowMs, scope, calendarTimeZone);
  const calendarFootnote =
    calendarTimeZone === "UTC"
      ? "Uses the same day boundaries as your stats (UTC), so this lines up when you open charts."
      : "";

  const total = summary.total_scrobbles;
  const topArtist = summary.top_artists[0];
  const topTrack = summary.top_tracks[0];
  const topAlbum = summary.top_albums[0];
  const prior = priorWeekSummary ?? null;
  const priorTotal = prior?.total_scrobbles ?? 0;
  const yearAgo = yearAgoSummary ?? null;

  if (total < 1) {
    const lines = [
      "You have not logged any plays in the last seven days yet. Once listening shows up here, this space becomes a short read on your week.",
    ];
    const narrativeParagraphs = linesToNarrativeParagraphs(lines);
    return {
      scope,
      greetingLine1,
      dateHeadline,
      calendarFootnote,
      narrativeParagraphs,
      secondaryInsights: [],
      yesterdaySnapshot: null,
      cards: [
        { kicker: "Top artist", title: "—", detail: "No plays in this window" },
        { kicker: "Peak day", title: "—", detail: null },
      ],
      actions: buildBriefingActions({ scope, hasYearAgoSecondary: false }),
    };
  }

  const yesterdayYmd = calendarYesterdayYmd(nowMs, calendarTimeZone);
  const dayBeforeYmd = yesterdayYmd ? addCalendarDaysYmd(yesterdayYmd, -1) : null;

  let yPlays = 0;
  let dPlays = 0;
  if (heroWindow.timeline_grain === "utc_day" && yesterdayYmd && dayBeforeYmd) {
    yPlays = timelinePlaysForYmd(heroWindow.timeline, yesterdayYmd);
    dPlays = timelinePlaysForYmd(heroWindow.timeline, dayBeforeYmd);
  }

  const lines: string[] = [];

  const peakForNarrative = displayUtcWeekdayPeak(heroWindow.weekday_peak);
  const behaviorForNarrative = inWindowBehaviorInsight(summary);
  const comfortLine = comfortExplorationSentence(summary);

  if (friday) {
    if (topArtist && topArtist.plays > 0) {
      lines.push(
        `${weeklyListeningOpeningClause(total)}, with ${weeklyTopArtistFocusFragment(topArtist, summary)}.`,
      );
    } else {
      lines.push(`${weeklyListeningOpeningClause(total)}.`);
    }
    // Peak weekday shape is reserved for support cards on Friday so the row stays non-redundant.
    if (lines.length < 3 && total < 15) {
      lines.push(
        "It is still early to close the books on this week — a fuller picture will settle as more plays land.",
      );
    }
    if (lines.length < 3 && behaviorForNarrative && !behaviorForNarrative.startsWith("Once")) {
      lines.push(behaviorForNarrative);
    } else if (lines.length < 3 && comfortLine) {
      lines.push(comfortLine);
    }
  } else if (heroWindow.timeline_grain === "utc_day" && yesterdayYmd && dayBeforeYmd) {
    if (yPlays > 0) {
      let tail: string;
      if (dPlays <= 0) {
        tail = "That stands out after a very quiet day before.";
      } else if (!meaningfulDailyDelta(yPlays, dPlays)) {
        tail = "That is about the same energy as the day before once small swings are set aside.";
      } else if (yPlays > dPlays) {
        tail = "That is a clear step up from the day before.";
      } else if (yPlays < dPlays) {
        tail = "That lands a little softer than the day before.";
      } else {
        tail = "That matches the pace from the day before.";
      }
      lines.push(`You listened to ${formatCountWord(yPlays, "track")} yesterday. ${tail}`);
    } else {
      lines.push(`Across the last seven days you listened to ${formatCountWord(total, "track")}.`);
    }
    if (topArtist && topArtist.plays > 0 && lines.length < 3) {
      const share = topArtist.plays / total;
      if (share >= 0.35) {
        lines.push(`${topArtist.name} carried most of what this seven-day stretch sounds like.`);
      } else {
        lines.push(`Listening still leaned on ${topArtist.name} more than other names in this stretch.`);
      }
    }
    if (lines.length < 3 && peakForNarrative && peakForNarrative.count > 0) {
      lines.push(`Your listening gathered most on ${peakForNarrative.name}s this week.`);
    }
    if (lines.length < 3 && behaviorForNarrative && !behaviorForNarrative.startsWith("Once")) {
      lines.push(behaviorForNarrative);
    } else if (lines.length < 3 && comfortLine) {
      lines.push(comfortLine);
    }
  } else {
    lines.push(`Across the last seven days you listened to ${formatCountWord(total, "track")}.`);
    if (topArtist && topArtist.plays > 0 && lines.length < 3) {
      lines.push(`Listening still leaned on ${topArtist.name} more than other names in this stretch.`);
    }
    if (lines.length < 3 && peakForNarrative && peakForNarrative.count > 0) {
      lines.push(`Your listening gathered most on ${peakForNarrative.name}s this week.`);
    }
    if (lines.length < 3 && behaviorForNarrative && !behaviorForNarrative.startsWith("Once")) {
      lines.push(behaviorForNarrative);
    } else if (lines.length < 3 && comfortLine) {
      lines.push(comfortLine);
    }
  }

  const narrativeParagraphs = linesToNarrativeParagraphs(lines);
  const narrativeText = narrativePlainText(narrativeParagraphs);
  const behaviorLine =
    behaviorForNarrative && !behaviorForNarrative.startsWith("Once")
      ? behaviorForNarrative
      : null;

  const streakEndYmd = yesterdayYmd ?? "";
  const listeningStreakDays =
    heroWindow.timeline_grain === "utc_day" && streakEndYmd.length > 0
      ? consecutiveListeningDaysEndingOnYmd(heroWindow.timeline, streakEndYmd)
      : 0;

  const secondaryInsights = buildSecondaryInsights({
    scope,
    narrativeText,
    yPlays,
    dPlays,
    total,
    priorTotal,
    priorTopName: prior?.top_artists[0]?.name,
    topArtist,
    summary,
    behavior: behaviorLine,
    yearAgo,
    comfort: comfortLine,
    listeningStreakDays,
    returnAfterGapSentence,
  });

  const hasYearAgoSecondary = secondaryInsights.some((r) => r.tag === "A YEAR AGO");

  let yesterdaySnapshot: { body: string } | null = null;
  if (heroWindow.timeline_grain === "utc_day" && yesterdayYmd) {
    const y = timelinePlaysForYmd(heroWindow.timeline, yesterdayYmd);
    const yDay = weekdayLongForYmdAtNoonUtc(yesterdayYmd, calendarTimeZone);
    const showFridayBlock = friday;
    const showWeekdayLate = !friday && localHour >= 15;
    if (showFridayBlock || showWeekdayLate) {
      if (y > 0) {
        const roughAvg = total > 0 ? total / 7 : y;
        let body: string;
        if (showFridayBlock) {
          if (y < roughAvg * 0.65) {
            body = `${yDay} was a lighter day — you eased off compared with the pace earlier in the week.`;
          } else if (y > roughAvg * 1.35) {
            body = `${yDay} picked up — more motion than the quieter stretch in the middle of the week.`;
          } else {
            body = `${yDay} sat close to the week's usual rhythm — a steady slice after the broader pattern.`;
          }
        } else if (y < roughAvg * 0.65) {
          body = `Yesterday (${yDay}) landed softer — a calmer day after a busier stretch.`;
        } else if (y > roughAvg * 1.35) {
          body = `Yesterday (${yDay}) had a bit more pulse than the days just around it.`;
        } else {
          body = `Yesterday (${yDay}) felt like a typical day in how you've been listening this week.`;
        }
        yesterdaySnapshot = { body };
      } else {
        yesterdaySnapshot = {
          body: `${yDay} was quiet — no plays logged that day.`,
        };
      }
    }
  }

  const cards = buildSupportCards({
    friday,
    narrativeText,
    secondaryInsights,
    total,
    summary,
    topArtist,
    topTrack,
    topAlbum,
    peakForNarrative,
    comfortLine,
    listeningStreakDays,
    returnAfterGapSentence,
  });

  return {
    scope,
    greetingLine1,
    dateHeadline,
    calendarFootnote,
    narrativeParagraphs,
    secondaryInsights,
    yesterdaySnapshot,
    cards,
    actions: buildBriefingActions({ scope, hasYearAgoSecondary }),
  };
}

/**
 * Core-plan shell: same greeting/date chrome as a normal briefing, without listening-derived
 * narrative, cards, or snapshot reads. The home surface renders the Advanced gate client module
 * for the locked-state body; this object carries calendar chrome only.
 */
export function buildDashboardHomeAdvancedGateBriefing(input: Readonly<{
  nowMs: number;
  displayName: string | null;
  calendarTimeZone: string;
}>): DashboardHomeBriefing {
  const { nowMs, displayName, calendarTimeZone } = input;
  const friday = isFridayInTimeZone(nowMs, calendarTimeZone);
  const scope: "daily" | "weekly" = friday ? "weekly" : "daily";
  const first = greetingFirstName(displayName);
  const greetingLine1 = first != null ? `Welcome back, ${first}.` : "Welcome back.";
  const dateHeadline = dateHeadlineForScope(nowMs, scope, calendarTimeZone);
  const calendarFootnote =
    calendarTimeZone === "UTC"
      ? "Uses the same day boundaries as your stats (UTC), so this lines up when you open charts."
      : "";
  return {
    scope,
    greetingLine1,
    dateHeadline,
    calendarFootnote,
    narrativeParagraphs: [],
    secondaryInsights: [],
    yesterdaySnapshot: null,
    cards: [],
    actions: [],
  };
}
