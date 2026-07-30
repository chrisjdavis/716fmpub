import { describe, expect, it } from "vitest";
import {
  assertTransitionImportJobStage,
  canTransitionImportJobStage,
  isTerminalImportJobStage,
} from "./jobLifecycle.js";

describe("import job lifecycle", () => {
  it("treats completed and failed as terminal", () => {
    expect(isTerminalImportJobStage("completed")).toBe(true);
    expect(isTerminalImportJobStage("failed")).toBe(true);
    expect(isTerminalImportJobStage("running")).toBe(false);
  });

  it("allows the MVP path queued -> running -> completed", () => {
    expect(canTransitionImportJobStage("queued", "running")).toBe(true);
    expect(canTransitionImportJobStage("running", "completed")).toBe(true);
  });

  it("allows failure from queued or running", () => {
    expect(canTransitionImportJobStage("queued", "failed")).toBe(true);
    expect(canTransitionImportJobStage("running", "failed")).toBe(true);
  });

  it("allows re-queueing a stale running job back to queued", () => {
    expect(canTransitionImportJobStage("running", "queued")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransitionImportJobStage("queued", "completed")).toBe(false);
    expect(canTransitionImportJobStage("idle", "running")).toBe(false);
    expect(canTransitionImportJobStage("completed", "running")).toBe(false);
  });

  it("allows idempotent same-stage checks", () => {
    expect(canTransitionImportJobStage("running", "running")).toBe(true);
    assertTransitionImportJobStage("running", "running");
  });

  it("throws on unsupported transitions", () => {
    expect(() =>
      assertTransitionImportJobStage("completed", "running"),
    ).toThrow("Unsupported import job stage transition");
  });
});
