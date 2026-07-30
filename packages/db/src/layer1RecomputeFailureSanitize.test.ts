import { describe, expect, it } from "vitest";
import { sanitizeLayer1RecomputeFailureMessageForPersistence } from "./layer1RecomputeFailureSanitize.js";

describe("sanitizeLayer1RecomputeFailureMessageForPersistence", () => {
  it("redacts unix-style paths", () => {
    expect(
      sanitizeLayer1RecomputeFailureMessageForPersistence(
        "ENOENT: not found open /Users/dev/proj/foo.ts",
        "layer1_user_hard_error",
      ),
    ).toBe("ENOENT: not found open <path>");
  });

  it("uses code fallback when nothing remains", () => {
    expect(sanitizeLayer1RecomputeFailureMessageForPersistence("   \n  ", "layer1_x")).toBe(
      "(layer1_x)",
    );
  });
});
