/**
 * Deterministic current-vs-prior and current-vs-year-ago comparison metrics (VS-49 TASK 2.4).
 * Callers supply eligibility flags (typically from {@link computeListenHistoryCoverageQuality})
 * and per-window count slices from the backend — no inference from missing peers.
 */

export const LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1 =
  "716fm.listening_history.window_comparison.v1" as const;

export type ListeningWindowCountSlice = Readonly<{
  playCount: number;
  distinctArtistCount: number | null;
  distinctTrackCount: number | null;
  /**
   * Plays in the window attributed to artists whose first-ever user listen falls in this window.
   * Must align with the SQL contract used for discovery / “new in window” rollups (`null` when unknown).
   */
  noveltyAttributedPlayCount: number | null;
  /**
   * Plays in the window attributed to artists the user had heard before the window started.
   * When both novelty and familiarity are non-null, they must sum to `playCount` or balance is withheld.
   */
  familiarityAttributedPlayCount: number | null;
}>;

export type ListeningWindowComparisonInput = Readonly<{
  comparableToPriorWindowSameGrain: boolean;
  comparableToYearAgoWindowSameGrain: boolean;
  current: ListeningWindowCountSlice;
  priorWindow: ListeningWindowCountSlice | null;
  yearAgoWindow: ListeningWindowCountSlice | null;
}>;

export type WindowPeerComparisonNotComputedReason =
  | "NOT_FLAGGED_COMPARABLE"
  | "MISSING_PEER_SLICE"
  | "INVALID_PEER_SLICE"
  | "INVALID_CURRENT_SLICE";

export type WindowPeerComparisonBlock = Readonly<
  | {
      computed: false;
      reason: WindowPeerComparisonNotComputedReason;
    }
  | {
      computed: true;
      peerPlayCount: number;
      peerDistinctArtistCount: number | null;
      peerDistinctTrackCount: number | null;
      playCountAbsoluteDelta: number;
      /** `(current - peer) / peer` when `peerPlayCount > 0`; otherwise `null` (no fake ratio). */
      playCountRelativeDelta: number | null;
      distinctArtistCountAbsoluteDelta: number | null;
      distinctTrackCountAbsoluteDelta: number | null;
    }
>;

export type NoveltyFamiliarityBalanceBlock = Readonly<
  | {
      available: false;
      reason: "INCOMPLETE_INPUT" | "SUM_MISMATCH" | "ZERO_PLAYS" | "INVALID_CURRENT_SLICE";
    }
  | {
      available: true;
      noveltyAttributedPlayCount: number;
      familiarityAttributedPlayCount: number;
      /** `noveltyAttributedPlayCount / playCount` when `playCount > 0`. */
      noveltyShareOfPlays: number;
    }
>;

export type ListeningWindowComparisonAnomalyCandidates = Readonly<{
  /**
   * `current.playCount / prior.playCount` when prior-window comparison computed and prior plays > 0.
   */
  volumeRatioVersusPrior: number | null;
  /**
   * `current.playCount / yearAgo.playCount` when year-ago comparison computed and year-ago plays > 0.
   */
  volumeRatioVersusYearAgo: number | null;
  /**
   * `current.distinctArtist / prior.distinctArtist` when both known, prior > 0, and prior comparison computed.
   */
  distinctArtistBreadthRatioVersusPrior: number | null;
  /**
   * Same as breadth ratio for the year-ago peer when that comparison is computed.
   */
  distinctArtistBreadthRatioVersusYearAgo: number | null;
  /**
   * `distinctTrackCount / playCount` on the current slice when both known and `playCount > 0`.
   * Low values correlate with repeat-heavy windows (ranking hint only).
   */
  trackBreadthPerPlayCurrent: number | null;
  /**
   * Absolute play delta vs prior when that comparison is computed; otherwise `null`.
   */
  playCountAbsoluteDeltaVersusPriorMagnitude: number | null;
}>;

export type ListeningWindowComparisonResult = Readonly<{
  metricFamily: typeof LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1;
  currentPlayCount: number;
  currentDistinctArtistCount: number | null;
  currentDistinctTrackCount: number | null;
  versusPriorWindow: WindowPeerComparisonBlock;
  versusYearAgoWindow: WindowPeerComparisonBlock;
  noveltyFamiliarityBalanceCurrent: NoveltyFamiliarityBalanceBlock;
  anomalyCandidates: ListeningWindowComparisonAnomalyCandidates;
}>;

function isNonNegativeInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

function sliceWellFormed(s: ListeningWindowCountSlice): boolean {
  if (!isNonNegativeInteger(s.playCount)) {
    return false;
  }
  const checkNullOrInt = (v: number | null) => v == null || isNonNegativeInteger(v);
  if (
    !checkNullOrInt(s.distinctArtistCount) ||
    !checkNullOrInt(s.distinctTrackCount) ||
    !checkNullOrInt(s.noveltyAttributedPlayCount) ||
    !checkNullOrInt(s.familiarityAttributedPlayCount)
  ) {
    return false;
  }
  if (s.distinctArtistCount != null && s.distinctArtistCount > s.playCount) {
    return false;
  }
  if (s.distinctTrackCount != null && s.distinctTrackCount > s.playCount) {
    return false;
  }
  if (s.noveltyAttributedPlayCount != null && s.noveltyAttributedPlayCount > s.playCount) {
    return false;
  }
  if (s.familiarityAttributedPlayCount != null && s.familiarityAttributedPlayCount > s.playCount) {
    return false;
  }
  return true;
}

function buildPeerComparison(input: Readonly<{
  comparable: boolean;
  peer: ListeningWindowCountSlice | null;
  current: ListeningWindowCountSlice;
  currentOk: boolean;
}>): WindowPeerComparisonBlock {
  if (!input.currentOk) {
    return { computed: false, reason: "INVALID_CURRENT_SLICE" };
  }
  if (!input.comparable) {
    return { computed: false, reason: "NOT_FLAGGED_COMPARABLE" };
  }
  if (input.peer == null) {
    return { computed: false, reason: "MISSING_PEER_SLICE" };
  }
  if (!sliceWellFormed(input.peer)) {
    return { computed: false, reason: "INVALID_PEER_SLICE" };
  }
  const cur = input.current.playCount;
  const peer = input.peer.playCount;
  const playCountAbsoluteDelta = cur - peer;
  const playCountRelativeDelta = peer > 0 ? playCountAbsoluteDelta / peer : null;

  let distinctArtistCountAbsoluteDelta: number | null = null;
  if (input.current.distinctArtistCount != null && input.peer.distinctArtistCount != null) {
    distinctArtistCountAbsoluteDelta =
      input.current.distinctArtistCount - input.peer.distinctArtistCount;
  }

  let distinctTrackCountAbsoluteDelta: number | null = null;
  if (input.current.distinctTrackCount != null && input.peer.distinctTrackCount != null) {
    distinctTrackCountAbsoluteDelta = input.current.distinctTrackCount - input.peer.distinctTrackCount;
  }

  return {
    computed: true,
    peerPlayCount: peer,
    peerDistinctArtistCount: input.peer.distinctArtistCount,
    peerDistinctTrackCount: input.peer.distinctTrackCount,
    playCountAbsoluteDelta,
    playCountRelativeDelta,
    distinctArtistCountAbsoluteDelta,
    distinctTrackCountAbsoluteDelta,
  };
}

function buildNoveltyFamiliarityBalance(
  current: ListeningWindowCountSlice,
  currentOk: boolean,
): NoveltyFamiliarityBalanceBlock {
  if (!currentOk) {
    return { available: false, reason: "INVALID_CURRENT_SLICE" };
  }
  if (current.playCount === 0) {
    return { available: false, reason: "ZERO_PLAYS" };
  }
  const n = current.noveltyAttributedPlayCount;
  const f = current.familiarityAttributedPlayCount;
  if (n == null || f == null) {
    return { available: false, reason: "INCOMPLETE_INPUT" };
  }
  if (n + f !== current.playCount) {
    return { available: false, reason: "SUM_MISMATCH" };
  }
  return {
    available: true,
    noveltyAttributedPlayCount: n,
    familiarityAttributedPlayCount: f,
    noveltyShareOfPlays: n / current.playCount,
  };
}

function anomalyCandidatesFrom(
  current: ListeningWindowCountSlice,
  currentOk: boolean,
  prior: WindowPeerComparisonBlock,
  year: WindowPeerComparisonBlock,
): ListeningWindowComparisonAnomalyCandidates {
  const trackBreadthPerPlayCurrent =
    currentOk &&
    current.distinctTrackCount != null &&
    current.playCount > 0 &&
    isNonNegativeInteger(current.distinctTrackCount)
      ? current.distinctTrackCount / current.playCount
      : null;

  const volumeRatioVersusPrior =
    prior.computed && prior.peerPlayCount > 0 ? current.playCount / prior.peerPlayCount : null;

  const volumeRatioVersusYearAgo =
    year.computed && year.peerPlayCount > 0 ? current.playCount / year.peerPlayCount : null;

  let distinctArtistBreadthRatioVersusPrior: number | null = null;
  if (
    prior.computed &&
    current.distinctArtistCount != null &&
    prior.peerDistinctArtistCount != null &&
    prior.peerDistinctArtistCount > 0
  ) {
    distinctArtistBreadthRatioVersusPrior =
      current.distinctArtistCount / prior.peerDistinctArtistCount;
  }

  let distinctArtistBreadthRatioVersusYearAgo: number | null = null;
  if (
    year.computed &&
    current.distinctArtistCount != null &&
    year.peerDistinctArtistCount != null &&
    year.peerDistinctArtistCount > 0
  ) {
    distinctArtistBreadthRatioVersusYearAgo =
      current.distinctArtistCount / year.peerDistinctArtistCount;
  }

  const playCountAbsoluteDeltaVersusPriorMagnitude =
    prior.computed ? Math.abs(prior.playCountAbsoluteDelta) : null;

  return {
    volumeRatioVersusPrior,
    volumeRatioVersusYearAgo,
    distinctArtistBreadthRatioVersusPrior,
    distinctArtistBreadthRatioVersusYearAgo,
    trackBreadthPerPlayCurrent,
    playCountAbsoluteDeltaVersusPriorMagnitude,
  };
}

/**
 * Pure comparison bundle: uses caller-supplied comparability flags and slices only.
 * Year-ago and prior sections stay non-computed unless both the flag is true and the peer slice is valid.
 */
export function computeListeningWindowComparisons(
  input: ListeningWindowComparisonInput,
): ListeningWindowComparisonResult {
  const currentOk = sliceWellFormed(input.current);

  const versusPriorWindow = buildPeerComparison({
    comparable: input.comparableToPriorWindowSameGrain,
    peer: input.priorWindow,
    current: input.current,
    currentOk,
  });

  const versusYearAgoWindow = buildPeerComparison({
    comparable: input.comparableToYearAgoWindowSameGrain,
    peer: input.yearAgoWindow,
    current: input.current,
    currentOk,
  });

  const noveltyFamiliarityBalanceCurrent = buildNoveltyFamiliarityBalance(input.current, currentOk);

  const anomalyCandidates = anomalyCandidatesFrom(
    input.current,
    currentOk,
    versusPriorWindow,
    versusYearAgoWindow,
  );

  return {
    metricFamily: LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1,
    currentPlayCount: currentOk ? input.current.playCount : 0,
    currentDistinctArtistCount: currentOk ? input.current.distinctArtistCount : null,
    currentDistinctTrackCount: currentOk ? input.current.distinctTrackCount : null,
    versusPriorWindow,
    versusYearAgoWindow,
    noveltyFamiliarityBalanceCurrent,
    anomalyCandidates,
  };
}
