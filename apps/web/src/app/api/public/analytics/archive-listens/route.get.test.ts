import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoisted = vi.hoisted(() => ({
  getSoleOwnerPublicListeningAccess: vi.fn(),
  readCachedArchiveListensPage: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({ query: vi.fn() })),
    getSoleOwnerPublicListeningAccess: hoisted.getSoleOwnerPublicListeningAccess,
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    deployEnv: "test",
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("@/server/cached-read-heavy-queries", () => ({
  readCachedArchiveListensPage: hoisted.readCachedArchiveListensPage,
}));

vi.mock("@/server/read-cache-http-meta", () => ({
  attachReadCacheHttpMeta: vi.fn(),
}));

import { GET } from "./route";

describe("GET /api/public/analytics/archive-listens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when listening history is not public", async () => {
    hoisted.getSoleOwnerPublicListeningAccess.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/public/analytics/archive-listens"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "listening_history_not_public" });
    expect(hoisted.readCachedArchiveListensPage).not.toHaveBeenCalled();
  });

  it("returns sole-owner listens when public", async () => {
    hoisted.getSoleOwnerPublicListeningAccess.mockResolvedValue({
      userId: "owner-1",
      display_name: "Ada",
      stats_timezone: "UTC",
      product_plan: "advanced",
    });
    hoisted.readCachedArchiveListensPage.mockResolvedValue({
      listens: [
        {
          listen_id: "l1",
          played_at: "2024-01-01T00:00:00.000Z",
          track_title: "Song",
          artist_name: "Artist",
          album_title: null,
          listen_source: "lastfm",
          musicbrainz_recording_mbid: null,
          musicbrainz_release_mbid: null,
          lastfm_cover_image_url: null,
        },
      ],
      read_cache: { served_from: "miss", key: "k", ttl_ms: 1 },
    });

    const res = await GET(
      new Request("http://localhost/api/public/analytics/archive-listens?range=all&limit=40"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listens).toHaveLength(1);
    expect(hoisted.readCachedArchiveListensPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "owner-1" }),
    );
  });
});
