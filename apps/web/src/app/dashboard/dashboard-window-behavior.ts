import type { DashboardListenSummary } from "@vs/db";

const UTC_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** From recent rows only; caption elsewhere should say it is sampled from recent plays. */
export function mostActiveUtcWeekdayFromRecent(
  listens: readonly { played_at: string }[],
): { name: (typeof UTC_WEEKDAYS)[number]; count: number } | null {
  if (listens.length === 0) {
    return null;
  }
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of listens) {
    const ms = Date.parse(row.played_at);
    if (!Number.isFinite(ms)) {
      continue;
    }
    const wd = new Date(ms).getUTCDay();
    counts[wd] += 1;
  }
  let bestI = 0;
  let best = counts[0] ?? 0;
  for (let i = 1; i < 7; i += 1) {
    if (counts[i]! > best) {
      best = counts[i]!;
      bestI = i;
    }
  }
  if (best === 0) {
    return null;
  }
  return { name: UTC_WEEKDAYS[bestI]!, count: best };
}

/** Label for SQL `extract(dow …)` / JS `getUTCDay()` peak (full-window aggregate). */
export function displayUtcWeekdayPeak(
  peak: { utc_weekday: number; plays: number } | null,
): { name: (typeof UTC_WEEKDAYS)[number]; count: number } | null {
  if (!peak) {
    return null;
  }
  const dow = peak.utc_weekday;
  if (!Number.isFinite(dow) || dow < 0 || dow > 6 || peak.plays < 1) {
    return null;
  }
  return { name: UTC_WEEKDAYS[dow]!, count: peak.plays };
}

export function replayBehaviorFromSummary(summary: DashboardListenSummary): {
  title: string;
  subtitle: string;
} {
  const total = summary.total_scrobbles;
  if (total < 1) {
    return { title: "—", subtitle: "No plays in this window yet." };
  }
  const topPlays = summary.top_tracks[0]?.plays ?? 0;
  const share = topPlays / total;
  const tracksWithRepeats = summary.top_tracks.filter((t) => t.plays >= 2).length;

  if (share >= 0.12) {
    return {
      title: "High repetition",
      subtitle:
        tracksWithRepeats >= 3
          ? "Several tracks are carrying a large share of plays this window."
          : "A small set of tracks is dominating your plays this window.",
    };
  }
  if (share >= 0.06) {
    return {
      title: "Mixed listening",
      subtitle: "Repeats show up, but plays are spread across more titles.",
    };
  }
  return {
    title: "Varied rotation",
    subtitle: "Plays look spread out across many different tracks.",
  };
}

/** One-line copy for the “in this window” narrative block (non-AI). Null when there is nothing to call out. */
export function inWindowBehaviorInsight(summary: DashboardListenSummary): string | null {
  const total = summary.total_scrobbles;
  if (total < 1) {
    return "Once this window has plays, a short behavior readout will appear here.";
  }
  const topPlays = summary.top_tracks[0]?.plays ?? 0;
  const share = topPlays / total;
  if (share >= 0.12) {
    return "You kept coming back to the same few tracks more than usual — a tighter loop than the rest of the window.";
  }
  if (share >= 0.06) {
    return "Repeats show up, but you are still moving across a wider set of tracks than a single-title binge.";
  }
  return null;
}
