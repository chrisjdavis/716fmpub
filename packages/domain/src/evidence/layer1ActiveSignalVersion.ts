import {
  ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION,
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
} from "../artistUserRelationshipSignals.js";
import { LAYER1_EVIDENCE_SCHEMA_VERSION } from "./layer1EvidenceObject.js";

/**
 * Single source of truth for the **active** Layer 1 signal version string (VS-75).
 * Used for durable `layer1_user_recompute_state.signal_version` on successful recompute
 * and for freshness reconciliation: any row whose stored version differs is stale.
 *
 * Bump when `signal_kind`, `signal_definition_version`, or evidence schema changes.
 */
export const LAYER1_ACTIVE_SIGNAL_VERSION = [
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  `def_${ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION}`,
  `evidence_v${LAYER1_EVIDENCE_SCHEMA_VERSION}`,
].join(":");

/**
 * Builds the same composite version string persisted on `layer1_user_recompute_state` /
 * targeted by workers, from `layer1_evidence_objects` column mirrors.
 */
export function formatLayer1SignalVersionFromEvidenceColumns(input: Readonly<{
  signalKind: string;
  signalDefinitionVersion: string;
  evidenceSchemaVersion: number;
}>): string {
  return [
    input.signalKind,
    `def_${input.signalDefinitionVersion}`,
    `evidence_v${input.evidenceSchemaVersion}`,
  ].join(":");
}
