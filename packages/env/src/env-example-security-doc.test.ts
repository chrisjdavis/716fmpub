import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STAGING_STRICT_SECURITY_ENV_VAR_NAMES } from "./tier-matrix.js";

const here = dirname(fileURLToPath(import.meta.url));
const envExamplePath = join(here, "../../../.env.example");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Each key must appear as a whole token on some line of `.env.example` (assignment, commented assignment, or prose).
 */
function envExampleDocumentsKey(content: string, key: string): boolean {
  const re = new RegExp(`(^|\\n)[^\\n]*\\b${escapeRegExp(key)}\\b`, "m");
  return re.test(content);
}

describe(".env.example security documentation", () => {
  it("documents every strict-tier security-critical variable name", () => {
    const text = readFileSync(envExamplePath, "utf8");
    for (const key of STAGING_STRICT_SECURITY_ENV_VAR_NAMES) {
      expect(
        envExampleDocumentsKey(text, key),
        `missing documentation for ${key} in .env.example (see packages/env/src/tier-matrix.ts)`,
      ).toBe(true);
    }
  });
});
