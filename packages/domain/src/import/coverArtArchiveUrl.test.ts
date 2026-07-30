import { describe, expect, it } from "vitest";
import { coverArtArchiveFrontThumbnailUrl } from "./coverArtArchiveUrl.js";

describe("coverArtArchiveFrontThumbnailUrl", () => {
  it("returns null for empty input", () => {
    expect(coverArtArchiveFrontThumbnailUrl(null)).toBeNull();
    expect(coverArtArchiveFrontThumbnailUrl(undefined)).toBeNull();
    expect(coverArtArchiveFrontThumbnailUrl("")).toBeNull();
    expect(coverArtArchiveFrontThumbnailUrl("  ")).toBeNull();
  });

  it("returns null when not UUID-shaped", () => {
    expect(coverArtArchiveFrontThumbnailUrl("not-a-uuid")).toBeNull();
    expect(coverArtArchiveFrontThumbnailUrl("550e8400-e29b-41d4-a716")).toBeNull();
  });

  it("builds front-250 URL with normalized lowercase MBID", () => {
    expect(
      coverArtArchiveFrontThumbnailUrl("  76DF3287-6CDA-33EB-8E9A-044B5E15FFDD  "),
    ).toBe("https://coverartarchive.org/release/76df3287-6cda-33eb-8e9a-044b5e15ffdd/front-250");
  });

  it("supports 500 and 1200 sizes", () => {
    const mbid = "76df3287-6cda-33eb-8e9a-044b5e15ffdd";
    expect(coverArtArchiveFrontThumbnailUrl(mbid, 500)).toBe(
      `https://coverartarchive.org/release/${mbid}/front-500`,
    );
    expect(coverArtArchiveFrontThumbnailUrl(mbid, 1200)).toBe(
      `https://coverartarchive.org/release/${mbid}/front-1200`,
    );
  });
});
