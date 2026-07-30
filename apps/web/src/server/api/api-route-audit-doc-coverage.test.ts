import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function collectRouteDirs(root: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectRouteDirs(p));
    } else if (ent.isFile() && ent.name === "route.ts") {
      out.push(path.dirname(p));
    }
  }
  return out;
}

function dirToApiPath(routeDir: string, apiRoot: string): string {
  const rel = path.relative(apiRoot, routeDir);
  const segs = rel.split(path.sep).filter(Boolean);
  return `/api/${segs.join("/")}`;
}

function monitoredPathsFromAudit(auditText: string): string[] {
  const m = auditText.match(
    /<!--\s*monitored-api-route-paths\s*\n([\s\S]*?)\n-->/,
  );
  if (!m) {
    throw new Error("missing monitored-api-route-paths block in audit doc");
  }
  return m[1]
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("VS-66 API audit doc coverage", () => {
  it("machine-readable inventory matches app/api route.ts files", () => {
    const webRoot = path.resolve(__dirname, "../../..");
    const apiRoot = path.join(webRoot, "src/app/api");
    const auditPath = path.resolve(
      webRoot,
      "../../docs/performance/vs-66-api-route-audit.md",
    );

    const auditText = fs.readFileSync(auditPath, "utf8");
    const fromDoc = new Set(monitoredPathsFromAudit(auditText));

    const fromDisk = new Set(
      collectRouteDirs(apiRoot).map((d) => dirToApiPath(d, apiRoot)),
    );

    const missingInDoc = [...fromDisk].filter((p) => !fromDoc.has(p));
    const extraInDoc = [...fromDoc].filter((p) => !fromDisk.has(p));

    expect(
      { missingInDoc, extraInDoc },
      "Update docs/performance/vs-66-api-route-audit.md monitored-api-route-paths when routes change",
    ).toEqual({ missingInDoc: [], extraInDoc: [] });
  });
});
