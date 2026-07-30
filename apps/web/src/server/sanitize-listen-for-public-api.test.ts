import { describe, expect, it } from "vitest";
import type { DashboardArchiveListen } from "@vs/db";
import {
  sanitizeDashboardArchiveListenForPublicApi,
  sanitizeDashboardRecentListenForPublicApi,
} from "./sanitize-listen-for-public-api";

const baseRecent = {
  listen_id: "l1",
  played_at: "2020-01-01T00:00:00.000Z",
  track_id: "t1",
  track_title: "ok",
  artist_name: "ok",
  album_id: null as string | null,
  album_title: null as string | null,
  musicbrainz_release_mbid: null as string | null,
  lastfm_cover_image_url: null as string | null,
};

describe("sanitizeDashboardRecentListenForPublicApi", () => {
  it("VS-51: strips NUL and bidi marks from track metadata strings", () => {
    const row = sanitizeDashboardRecentListenForPublicApi({
      ...baseRecent,
      track_title: `Evil\u0000<script>`,
      artist_name: `A\u202EB`,
      album_title: "C\u0001D",
    });
    expect(row.track_title).toBe("Evil<script>");
    expect(row.artist_name).toBe("AB");
    expect(row.album_title).toBe("C D");
  });
});

describe("sanitizeDashboardArchiveListenForPublicApi", () => {
  it("preserves listen_source while sanitizing text fields", () => {
    const row: DashboardArchiveListen = {
      ...baseRecent,
      listen_source: "import",
      track_title: "x\u0000y",
      artist_name: "a",
      album_title: null,
    };
    const out = sanitizeDashboardArchiveListenForPublicApi(row);
    expect(out.listen_source).toBe("import");
    expect(out.track_title).toBe("xy");
  });
});
