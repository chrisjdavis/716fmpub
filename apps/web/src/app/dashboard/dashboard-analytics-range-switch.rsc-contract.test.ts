import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

describe("dashboard-analytics-range-switch RSC contract (VS-75)", () => {
  it("stays a server component: no client directive, no React runtime imports, no hook calls", () => {
    const src = readFileSync(
      path.join(thisDir, "dashboard-analytics-range-switch.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/\buse(State|Effect|LayoutEffect|InsertionEffect|Memo|Callback|Ref|Context|Reducer|Id|ImperativeHandle|DebugValue|SyncExternalStore|DeferredValue|Transition|ActionState|FormState|Optimistic)\s*\(/);
    expect(src).not.toMatch(/from\s+["']react["']/);
    expect(src).not.toMatch(/from\s+["']react-dom["']/);
    expect(src).not.toMatch(/from\s+["']react-dom\/client["']/);
  });
});
