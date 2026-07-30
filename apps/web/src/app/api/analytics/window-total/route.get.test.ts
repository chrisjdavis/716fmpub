import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({})),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
}));

vi.mock("@/server/cached-read-heavy-queries", () => ({
  readCachedCanonicalDashboardListenSummary: vi.fn(),
}));

const hoistedWithApiSession = vi.hoisted(() =>
  vi.fn(
    async (
      _req: Request,
      run: (ctx: {
        user: {
          id: string;
          email: string;
          emailVerified: boolean;
          accountRole: "user" | "admin" | "owner";
          productPlan: "core" | "advanced";
        };
      }) => Promise<Response>,
    ) =>
      run({
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "u@example.com",
          emailVerified: true,
          accountRole: "user",
          productPlan: "core",
        },
      }),
  ),
);

vi.mock("@/server/api/require-session", () => ({
  withApiSession: hoistedWithApiSession,
}));

import { readCachedCanonicalDashboardListenSummary } from "@/server/cached-read-heavy-queries";
import { GET } from "./route";

describe("GET /api/analytics/window-total", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserScopedReadCacheForTests();
  });

  it("returns total_scrobbles from canonical SQL only (no dashboard_bundle snapshot read)", async () => {
    vi.mocked(readCachedCanonicalDashboardListenSummary).mockResolvedValue({
      summary: {
        range: "30d",
        total_scrobbles: 12,
        top_artists: [],
        top_tracks: [],
        top_albums: [],
      },
      read_cache: {
        namespace: "analytics_summary_canonical",
        served_from: "miss",
        max_stale_seconds: 120,
      },
    });

    const res = await GET(new Request("http://localhost/api/analytics/window-total?range=30d"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_scrobbles: number; source: string };
    expect(body.total_scrobbles).toBe(12);
    expect(body.source).toBe("canonical_listens");
    expect(readCachedCanonicalDashboardListenSummary).toHaveBeenCalledTimes(1);
  });
});
