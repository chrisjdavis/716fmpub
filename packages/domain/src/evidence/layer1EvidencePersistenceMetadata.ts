import type { Layer1EvidenceObject } from "./layer1EvidenceObject.js";
import type { JsonValue } from "./jsonValue.js";

/**
 * First-class metadata mirrored on `layer1_evidence_objects` for SQL filters and
 * operator queries without parsing `body_json`.
 */
export type Layer1EvidencePersistenceMetadata = Readonly<{
  insufficiencyEvaluationAsOfMs: number;
  eligibleForDownstreamUse: boolean;
  insufficiencyCodes: readonly string[];
  insufficiencyStructuredFactors: Readonly<Record<string, JsonValue>> | null;
  comparabilityMetricFamily: string;
  comparableWithinUser: boolean;
  comparableAcrossUsers: boolean;
  comparableWithinArtistEntity: boolean;
  comparableAcrossTemporalWindowsOfSameGrain: boolean;
  comparableToPriorWindowSameGrain: boolean;
  comparableToYearAgoWindowSameGrain: boolean;
}>;

export function extractLayer1EvidencePersistenceMetadata(
  evidence: Layer1EvidenceObject,
): Layer1EvidencePersistenceMetadata {
  const c = evidence.comparability;
  return {
    insufficiencyEvaluationAsOfMs: evidence.insufficiency.evaluationAsOfMs,
    eligibleForDownstreamUse: evidence.insufficiency.eligibleForDownstreamUse,
    insufficiencyCodes: evidence.insufficiency.codes,
    insufficiencyStructuredFactors: evidence.insufficiency.structuredFactors ?? null,
    comparabilityMetricFamily: c.metricFamily,
    comparableWithinUser: c.comparableWithinUser,
    comparableAcrossUsers: c.comparableAcrossUsers,
    comparableWithinArtistEntity: c.comparableWithinArtistEntity,
    comparableAcrossTemporalWindowsOfSameGrain:
      c.comparableAcrossTemporalWindowsOfSameGrain,
    comparableToPriorWindowSameGrain: c.comparableToPriorWindowSameGrain,
    comparableToYearAgoWindowSameGrain: c.comparableToYearAgoWindowSameGrain,
  };
}
