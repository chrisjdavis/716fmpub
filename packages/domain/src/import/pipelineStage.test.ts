import { describe, expect, it } from "vitest";
import {
  IMPORT_PIPELINE_STAGES,
  parseImportPipelineStage,
} from "./pipelineStage.js";

describe("parseImportPipelineStage", () => {
  it("accepts every canonical stage", () => {
    for (const s of IMPORT_PIPELINE_STAGES) {
      expect(parseImportPipelineStage(s)).toBe(s);
    }
  });

  it("rejects unknown strings", () => {
    expect(parseImportPipelineStage("succeeded")).toBeNull();
    expect(parseImportPipelineStage("")).toBeNull();
    expect(parseImportPipelineStage("runningx")).toBeNull();
  });
});
