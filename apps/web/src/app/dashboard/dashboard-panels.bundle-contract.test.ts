/**
 * Guards **source** import shape (static vs dynamic `import()`), not webpack output.
 * Chunk membership is validated with `next build`, `analyze:bundle`, and on-disk `.next/static/chunks`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

describe("dashboard-panels import source contract (VS-74)", () => {
  it("uses dynamic import() for dashboard-import-panels, not a static import line", () => {
    const src = readFileSync(path.join(thisDir, "dashboard-panels.tsx"), "utf8");
    expect(src).not.toMatch(/from ["']\.[/]dashboard-import-panels["']/);
    expect(src).toMatch(/import\(["']\.[/]dashboard-import-panels["']\)/);
  });
});
