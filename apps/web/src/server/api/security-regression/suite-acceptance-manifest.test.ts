import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Maps TASK 8.1 acceptance themes to files under `security-regression/`.
 * If a file is renamed or removed, this test fails so operators keep a single discoverable surface.
 */
const REQUIRED_SECURITY_REGRESSION_FILES = [
  "me-session-and-csrf.test.ts",
  "me-settings-patch-negative.test.ts",
  "auth-login-boundaries.test.ts",
  "auth-logout-csrf.test.ts",
  "scoped-routes-unauthenticated-session-gate.test.ts",
  "entitlement-advanced-ai-api-security.test.ts",
  "export-listen-post-csrf-and-gate.test.ts",
  "export-listen-download-access-contracts.test.ts",
  "cross-account-and-destructive.test.ts",
  "suite-acceptance-manifest.test.ts",
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Security regression: suite acceptance manifest", () => {
  it("lists every required regression module in this directory", () => {
    const names = fs.readdirSync(__dirname);
    for (const file of REQUIRED_SECURITY_REGRESSION_FILES) {
      expect(names, `Missing security regression file: ${file}`).toContain(file);
    }
  });

  it("keeps the auth logout route module present for logout behavior", () => {
    const webRoot = path.resolve(__dirname, "..", "..", "..", "..");
    const logoutRoute = path.join(webRoot, "src", "app", "api", "auth", "logout", "route.ts");
    expect(fs.existsSync(logoutRoute)).toBe(true);
  });
});
