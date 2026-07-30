import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const checklistPath = join(here, "../../../docs/pre-production-security-review-checklist.md");

describe("pre-production security review checklist", () => {
  it("exists and covers required release-readiness topics", () => {
    const text = readFileSync(checklistPath, "utf8");
    const lower = text.toLowerCase();
    expect(text).toContain("Release readiness sign-off");
    expect(lower).toContain("authentication");
    expect(lower).toContain("authorization");
    expect(lower).toContain("export");
    expect(lower).toContain("deletion");
    expect(lower).toContain("secret");
    expect(lower).toContain("log");
    expect(lower).toContain("rate limit");
    expect(lower).toContain("residual risk");
    expect(lower).toContain("critical");
    expect(lower).toContain("high");
  });
});
