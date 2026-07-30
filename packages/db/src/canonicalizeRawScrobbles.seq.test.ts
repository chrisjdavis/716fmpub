import { describe, expect, it, vi } from "vitest";

import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";

function pgUniqueError(): Error & { code: string } {
  const e = new Error("duplicate key") as Error & { code: string };
  e.code = "23505";
  return e;
}

describe("canonicalizePendingRawScrobblesBatch query contract (mocked)", () => {
  it("resolves track by recording MBID before touching artist tables", async () => {
    const pending = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
      import_job_id: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
      played_at: "2024-01-02T03:04:05.000Z",
      artist_name: "Ignored When MBID Hit",
      artist_mbid: null,
      album_name: null,
      album_mbid: null,
      track_name: "Track",
      track_mbid: "  AA-BB-CC-DD-EE-FF-00-11-22-33-44-55  ",
    };

    const query = vi.fn(async (sql: string) => {
      const s = typeof sql === "string" ? sql : String(sql);
      if (s === "begin") {
        return undefined;
      }
      if (s.includes("from raw_scrobbles") && s.includes("for update")) {
        return { rows: [pending] };
      }
      if (s.includes("from tracks") && s.includes("musicbrainz_recording_mbid")) {
        return { rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddd0001" }] };
      }
      if (s.includes("insert into listens")) {
        return { rows: [] };
      }
      if (s.includes("update raw_scrobbles") && s.includes("canonicalization_status")) {
        return { rows: [] };
      }
      if (s.includes("select canonicalization_status")) {
        return { rows: [{ canonicalization_status: "succeeded" }] };
      }
      if (s === "commit") {
        return undefined;
      }
      throw new Error(`unexpected SQL in MBID short path: ${s.slice(0, 120)}`);
    });

    const release = vi.fn();
    const out = await canonicalizePendingRawScrobblesBatch(
      { connect: vi.fn().mockResolvedValue({ query, release }) },
      {
        importJobId: pending.import_job_id,
        userId: pending.user_id,
        limit: 10,
      },
    );

    expect(out).toEqual({ examined: 1, succeeded: 1, failed: 0 });
    const hitArtist = query.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("from artists"),
    );
    expect(hitArtist).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("marks raw failed on listen unique_violation without rolling back the batch", async () => {
    const pending = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002",
      import_job_id: "cccccccc-cccc-4ccc-8ccc-cccccccc0002",
      played_at: "2024-06-01T12:00:00.000Z",
      artist_name: "Solo",
      artist_mbid: null,
      album_name: null,
      album_mbid: null,
      track_name: "Piece",
      track_mbid: "aa-bb-cc-dd-ee-ff-00-11-22-33-44-55",
    };

    const query = vi.fn(async (sql: string) => {
      const s = typeof sql === "string" ? sql : String(sql);
      if (s === "begin") {
        return undefined;
      }
      if (s.includes("from raw_scrobbles") && s.includes("for update")) {
        return { rows: [pending] };
      }
      if (s.includes("from tracks") && s.includes("musicbrainz_recording_mbid")) {
        return { rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddd0002" }] };
      }
      if (s.includes("insert into listens")) {
        throw pgUniqueError();
      }
      if (s.includes("update raw_scrobbles") && s.includes("canonicalization_status")) {
        return { rows: [] };
      }
      if (s.includes("select canonicalization_status")) {
        return { rows: [{ canonicalization_status: "failed" }] };
      }
      if (s === "commit") {
        return undefined;
      }
      throw new Error(`unexpected SQL in duplicate listen path: ${s.slice(0, 120)}`);
    });

    const release = vi.fn();
    const out = await canonicalizePendingRawScrobblesBatch(
      { connect: vi.fn().mockResolvedValue({ query, release }) },
      {
        importJobId: pending.import_job_id,
        userId: pending.user_id,
        limit: 10,
      },
    );

    expect(out).toEqual({ examined: 1, succeeded: 0, failed: 1 });
    expect(query.mock.calls.some((c) => c[0] === "commit")).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("uses album owner artist_id when release MBID exists but Last.fm artist MBID differs", async () => {
    const albumArtistId = "faa735f6-d898-46f8-b07f-fffe5decab22";
    const rawResolvedArtistId = "eb36b257-e061-4de3-a86c-a302c6c62dcf";
    const albumRowId = "9ed51639-2d88-43af-ba66-fbcd6a17ae4f";
    const newTrackId = "ffffffff-ffff-4fff-8fff-ffffffff0002";

    const pending = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004",
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb004",
      import_job_id: "cccccccc-cccc-4ccc-8ccc-cccccccc0004",
      played_at: "2022-02-02T02:02:02.000Z",
      artist_name: "Credited On Scrobble",
      artist_mbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      album_name: "Some Album",
      album_mbid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      track_name: "Track",
      track_mbid: null,
    };

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const s = typeof sql === "string" ? sql : String(sql);
      if (s === "begin") {
        return undefined;
      }
      if (s.includes("from raw_scrobbles") && s.includes("for update")) {
        return { rows: [pending] };
      }
      if (s.includes("from artists") && s.includes("musicbrainz_artist_mbid")) {
        return { rows: [{ id: rawResolvedArtistId }] };
      }
      if (s.includes("from albums") && s.includes("musicbrainz_release_mbid")) {
        return { rows: [{ id: albumRowId, artist_id: albumArtistId }] };
      }
      if (s.includes("coalesce(album_id") && s.includes("from tracks")) {
        return { rows: [] };
      }
      if (s.includes("insert into tracks") && s.includes("returning id")) {
        expect(params?.[0]).toBe(albumArtistId);
        return { rows: [{ id: newTrackId }] };
      }
      if (s.includes("insert into listens")) {
        return { rows: [] };
      }
      if (s.includes("update raw_scrobbles") && s.includes("canonicalization_status")) {
        return { rows: [] };
      }
      if (s.includes("select canonicalization_status")) {
        return { rows: [{ canonicalization_status: "succeeded" }] };
      }
      if (s === "commit") {
        return undefined;
      }
      throw new Error(`unexpected SQL in album-artist reconcile path: ${s.slice(0, 120)}`);
    });

    const release = vi.fn();
    const out = await canonicalizePendingRawScrobblesBatch(
      { connect: vi.fn().mockResolvedValue({ query, release }) },
      {
        importJobId: pending.import_job_id,
        userId: pending.user_id,
        limit: 10,
      },
    );

    expect(out).toEqual({ examined: 1, succeeded: 1, failed: 0 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("creates artist and track via name keys when MBIDs are absent", async () => {
    const pending = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003",
      import_job_id: "cccccccc-cccc-4ccc-8ccc-cccccccc0003",
      played_at: "2023-05-05T00:00:00.000Z",
      artist_name: "Name Artist",
      artist_mbid: null,
      album_name: null,
      album_mbid: null,
      track_name: "Name Track",
      track_mbid: null,
    };

    const newArtistId = "eeeeeeee-eeee-4eee-8eee-eeeeeeee0001";
    const newTrackId = "ffffffff-ffff-4fff-8fff-ffffffff0001";

    const query = vi.fn(async (sql: string) => {
      const s = typeof sql === "string" ? sql : String(sql);
      if (s === "begin") {
        return undefined;
      }
      if (s.includes("from raw_scrobbles") && s.includes("for update")) {
        return { rows: [pending] };
      }
      if (s.startsWith("select id from tracks where musicbrainz_recording_mbid =")) {
        return { rows: [] };
      }
      if (s.includes("from artists") && s.includes("name_key")) {
        return { rows: [] };
      }
      if (s.includes("insert into artists") && s.includes("returning id")) {
        return { rows: [{ id: newArtistId }] };
      }
      if (s.includes("coalesce(album_id") && s.includes("from tracks")) {
        return { rows: [] };
      }
      if (s.includes("insert into tracks") && s.includes("returning id")) {
        return { rows: [{ id: newTrackId }] };
      }
      if (s.includes("insert into listens")) {
        return { rows: [] };
      }
      if (s.includes("update raw_scrobbles") && s.includes("canonicalization_status")) {
        return { rows: [] };
      }
      if (s.includes("select canonicalization_status")) {
        return { rows: [{ canonicalization_status: "succeeded" }] };
      }
      if (s === "commit") {
        return undefined;
      }
      throw new Error(`unexpected SQL in name-key path: ${s.slice(0, 120)}`);
    });

    const release = vi.fn();
    const out = await canonicalizePendingRawScrobblesBatch(
      { connect: vi.fn().mockResolvedValue({ query, release }) },
      {
        importJobId: pending.import_job_id,
        userId: pending.user_id,
        limit: 10,
      },
    );

    expect(out).toEqual({ examined: 1, succeeded: 1, failed: 0 });
    expect(query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("insert into artists"))).toBe(
      true,
    );
    expect(query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("insert into tracks"))).toBe(
      true,
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
