import { describe, expect, it } from "vitest";
import {
  ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION,
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
} from "../artistUserRelationshipSignals.js";
import { LAYER1_EVIDENCE_SCHEMA_VERSION } from "./layer1EvidenceObject.js";
import {
  formatLayer1SignalVersionFromEvidenceColumns,
  LAYER1_ACTIVE_SIGNAL_VERSION,
} from "./layer1ActiveSignalVersion.js";

describe("LAYER1_ACTIVE_SIGNAL_VERSION", () => {
  it("is a single colon-delimited composite of kind, definition, and evidence schema", () => {
    const parts = LAYER1_ACTIVE_SIGNAL_VERSION.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(ARTIST_USER_RELATIONSHIP_SIGNAL_KIND);
    expect(parts[1]).toMatch(/^def_/);
    expect(parts[2]).toBe(`evidence_v${LAYER1_EVIDENCE_SCHEMA_VERSION}`);
  });

  it("treats any suffix drift as a distinct version (staleness contract)", () => {
    expect(`${LAYER1_ACTIVE_SIGNAL_VERSION}:prior`).not.toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
  });
});

describe("formatLayer1SignalVersionFromEvidenceColumns", () => {
  it("matches LAYER1_ACTIVE_SIGNAL_VERSION for current column mirrors", () => {
    expect(
      formatLayer1SignalVersionFromEvidenceColumns({
        signalKind: ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
        signalDefinitionVersion: ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION,
        evidenceSchemaVersion: LAYER1_EVIDENCE_SCHEMA_VERSION,
      }),
    ).toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
  });
});
