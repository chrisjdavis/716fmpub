import { IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY } from "@vs/db";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("import job list vs latest-job ordering", () => {
  it("exports a deterministic newest-first clause for Postgres", () => {
    expect(IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY).toBe(
      "created_at desc, id desc",
    );
  });

  it("wires GET /api/imports SQL through the shared constant", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const routeSrc = readFileSync(join(dir, "route.ts"), "utf8");
    expect(routeSrc).toContain("IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY");
    expect(routeSrc).toContain(
      "order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}",
    );
    expect(routeSrc).toContain("and source = 'user'");
  });

  it("POST delegates enqueue to shared helper", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const routeSrc = readFileSync(join(dir, "route.ts"), "utf8");
    expect(routeSrc).toContain("enqueueUserLastfmImport");
    const helperSrc = readFileSync(
      join(dir, "..", "..", "..", "server", "enqueue-user-lastfm-import.ts"),
      "utf8",
    );
    expect(helperSrc).toContain("countActiveImportJobsForUser");
    expect(helperSrc).toContain("enqueueImportsJob");
    expect(helperSrc).toContain("createImportsQueue");
    expect(helperSrc).toContain("queue.close");
    expect(helperSrc).toContain("isPostgresUniqueViolation");
  });
});
