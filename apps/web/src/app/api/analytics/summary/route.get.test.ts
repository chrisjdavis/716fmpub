import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateListeningHistoryDerivedReadCaches } from "@/server/listening-history-read-cache-invalidation";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const hoistedLayer1Enqueue = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ outcome: "enqueued" as const }),
);

vi.mock("@vs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/queue")>();
  return {
    ...actual,
    enqueueDashboardBundleAnalyticsForUserBestEffort: hoistedEnqueue,
  };
});

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({})),
    resolveDashboardAnalyticsBundleRead: vi.fn(),
    getDashboardListenSummary: vi.fn(),
    enqueueLayer1EvidenceRecomputeForUserBestEffort: hoistedLayer1Enqueue,
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
}));

const hoistedSession = vi.hoisted(() => ({
  productPlan: "advanced" as "core" | "advanced",
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
          productPlan: hoistedSession.productPlan,
        },
      }),
  ),
);

vi.mock("@/server/api/require-session", () => ({
  withApiSession: hoistedWithApiSession,
}));

import { getDashboardListenSummary, resolveDashboardAnalyticsBundleRead } from "@vs/db";
import type { DashboardAnalyticsBundleBodyV1 } from "@vs/db";
import { GET } from "./route";

function emptyRangeSlot(range: "7d" | "30d" | "90d" | "all") {
  return {
    summary: {
      range,
      total_scrobbles: 0,
      top_artists: [],
      top_tracks: [],
      top_albums: [],
    },
    recentListens: [],
    heroWindow: {
      weekday_peak: null,
      timeline_grain: "utc_day" as const,
      timeline: [],
    },
  };
}

function staleBundleStub(asOf: string): {
  status: "stale";
  snapshot_as_of: string;
  bundle: DashboardAnalyticsBundleBodyV1;
} {
  return {
    status: "stale",
    snapshot_as_of: asOf,
    bundle: {
      schema_version: 1,
      as_of: asOf,
      ranges: {
        "7d": emptyRangeSlot("7d"),
        "30d": emptyRangeSlot("30d"),
        "90d": emptyRangeSlot("90d"),
        all: emptyRangeSlot("all"),
      },
      archive_totals: {
        allTimeScrobbles: 0,
        firstListenAt: null,
        topArtistName: null,
        topArtistPlays: null,
      },
    },
  };
}

describe("GET /api/analytics/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserScopedReadCacheForTests();
    hoistedSession.productPlan = "advanced";
  });

  it("allows Core accounts (OSS: Advanced unlocked)", async () => {
    hoistedSession.productPlan = "core";
    vi.mocked(resolveDashboardAnalyticsBundleRead).mockResolvedValue({
      outcome: "miss",
      reason: "no_row",
    } as never);
    vi.mocked(getDashboardListenSummary).mockResolvedValue({
      total_scrobbles: 0,
      top_artists: [],
      top_tracks: [],
      top_albums: [],
    } as never);

    const res = await GET(new Request("http://localhost/api/analytics/summary"));
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });


  it("best-effort enqueues dashboard bundle recompute when snapshot is not fresh", async () => {
    vi.mocked(resolveDashboardAnalyticsBundleRead).mockResolvedValue(
      staleBundleStub("2020-01-01T00:00:00.000Z"),
    );
    vi.mocked(getDashboardListenSummary).mockResolvedValue({
      range: "30d",
      total_scrobbles: 3,
      top_artists: [],
      top_tracks: [],
      top_albums: [],
    });

    const res = await GET(
      new Request("http://localhost/api/analytics/summary?range=30d"),
    );

    expect(hoistedEnqueue).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
    );
    expect(hoistedLayer1Enqueue).toHaveBeenCalledWith({
      env: expect.anything(),
      db: expect.anything(),
      userId: "11111111-1111-4111-8111-111111111111",
      reason: "listen_ingested",
    });
    expect(getDashboardListenSummary).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("does not warm-enqueue when snapshot is fresh", async () => {
    vi.mocked(resolveDashboardAnalyticsBundleRead).mockResolvedValue({
      status: "fresh",
      bundle: {
        schema_version: 1,
        as_of: "2026-01-01T00:00:00.000Z",
        ranges: {
          "7d": {
            summary: {
              range: "7d",
              total_scrobbles: 1,
              top_artists: [],
              top_tracks: [],
              top_albums: [],
            },
            recentListens: [],
            heroWindow: { weekday_peak: null, timeline_grain: "utc_day", timeline: [] },
          },
          "30d": {
            summary: {
              range: "30d",
              total_scrobbles: 2,
              top_artists: [],
              top_tracks: [],
              top_albums: [],
            },
            recentListens: [],
            heroWindow: { weekday_peak: null, timeline_grain: "utc_day", timeline: [] },
          },
          "90d": {
            summary: {
              range: "90d",
              total_scrobbles: 2,
              top_artists: [],
              top_tracks: [],
              top_albums: [],
            },
            recentListens: [],
            heroWindow: { weekday_peak: null, timeline_grain: "utc_day", timeline: [] },
          },
          all: {
            summary: {
              range: "all",
              total_scrobbles: 2,
              top_artists: [],
              top_tracks: [],
              top_albums: [],
            },
            recentListens: [],
            heroWindow: { weekday_peak: null, timeline_grain: "utc_day", timeline: [] },
          },
        },
        archive_totals: {
          allTimeScrobbles: 2,
          firstListenAt: null,
          topArtistName: null,
          topArtistPlays: null,
        },
      },
    });

    await GET(new Request("http://localhost/api/analytics/summary?range=30d"));
    expect(hoistedEnqueue).not.toHaveBeenCalled();
    expect(hoistedLayer1Enqueue).not.toHaveBeenCalled();
    expect(getDashboardListenSummary).not.toHaveBeenCalled();
  });

  it("reuses canonical summary within TTL: second request is store_hit and one SQL call (latency proxy)", async () => {
    vi.mocked(resolveDashboardAnalyticsBundleRead).mockResolvedValue(
      staleBundleStub("2020-01-01T00:00:00.000Z"),
    );
    vi.mocked(getDashboardListenSummary).mockResolvedValue({
      range: "30d",
      total_scrobbles: 3,
      top_artists: [],
      top_tracks: [],
      top_albums: [],
    });

    const url = "http://localhost/api/analytics/summary?range=30d";
    const res1 = await GET(new Request(url));
    const res2 = await GET(new Request(url));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(getDashboardListenSummary).toHaveBeenCalledTimes(1);
    expect(res2.headers.get("X-VS-Read-Cache")).toContain("store_hit");
    const body1 = (await res1.json()) as {
      read_cache: { entries: { served_from: string }[] };
    };
    const body2 = (await res2.json()) as {
      read_cache: { entries: { served_from: string }[] };
    };
    expect(body1.read_cache.entries[0]?.served_from).toBe("miss");
    expect(body2.read_cache.entries[0]?.served_from).toBe("store_hit");
  });

  it("VS-79: centralized listening-history invalidation forces the next canonical read to miss", async () => {
    vi.mocked(resolveDashboardAnalyticsBundleRead).mockResolvedValue(
      staleBundleStub("2020-01-01T00:00:00.000Z"),
    );
    vi.mocked(getDashboardListenSummary).mockResolvedValue({
      range: "30d",
      total_scrobbles: 3,
      top_artists: [],
      top_tracks: [],
      top_albums: [],
    });

    const url = "http://localhost/api/analytics/summary?range=30d";
    await GET(new Request(url));
    await GET(new Request(url));
    expect(getDashboardListenSummary).toHaveBeenCalledTimes(1);

    invalidateListeningHistoryDerivedReadCaches("11111111-1111-4111-8111-111111111111");
    await GET(new Request(url));

    expect(getDashboardListenSummary).toHaveBeenCalledTimes(2);
  });
});
