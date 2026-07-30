import { describe, expect, it, vi } from "vitest";
import { deleteUserAccount } from "./deleteUserAccount.js";

describe("deleteUserAccount", () => {
  it("snapshots user-scoped counts and deletes the user row", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("select count(*) from listens")) {
        return Promise.resolve({
          rows: [
            {
              listens: "42",
              raw_scrobbles: "50",
              import_jobs: "2",
              export_jobs: "1",
              analytics_snapshots: "3",
            },
          ],
        });
      }
      if (sql.includes("select artifact_relative_path")) {
        return Promise.resolve({
          rows: [{ artifact_relative_path: "user/export.zip" }],
        });
      }
      if (sql.includes("delete from users")) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: "u1" }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const out = await deleteUserAccount(
      { query: query as never },
      "11111111-1111-4111-8111-111111111111",
    );

    expect(out).toEqual({
      userDeleted: true,
      listensDeleted: 42,
      rawScrobblesDeleted: 50,
      importJobsDeleted: 2,
      exportJobsDeleted: 1,
      analyticsSnapshotsDeleted: 3,
      exportArtifactRelativePaths: ["user/export.zip"],
    });
    expect(String(query.mock.calls.at(-1)?.[0])).toContain("delete from users");
  });
});
