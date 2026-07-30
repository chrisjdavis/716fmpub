import { describe, expect, it } from "vitest";
import { lastfmPreferredCoverImageUrlFromWirePayload } from "./lastfmCoverImageUrl.js";

describe("lastfmPreferredCoverImageUrlFromWirePayload", () => {
  it("returns null for non-objects", () => {
    expect(lastfmPreferredCoverImageUrlFromWirePayload(null)).toBeNull();
    expect(lastfmPreferredCoverImageUrlFromWirePayload("x")).toBeNull();
  });

  it("prefers larger sizes and album images over track when ranks tie by order", () => {
    const payload = {
      image: [{ size: "small", "#text": "https://cdn.example/small.png" }],
      album: {
        image: [
          { size: "medium", "#text": "https://cdn.example/med.png" },
          { size: "extralarge", "#text": "https://cdn.example/xl.png" },
        ],
      },
    };
    expect(lastfmPreferredCoverImageUrlFromWirePayload(payload)).toBe(
      "https://cdn.example/xl.png",
    );
  });

  it("falls back to track-level image when album has none", () => {
    const payload = {
      album: { "#text": "LP", mbid: "" },
      image: [{ size: "large", "#text": "https://cdn.example/large.png" }],
    };
    expect(lastfmPreferredCoverImageUrlFromWirePayload(payload)).toBe(
      "https://cdn.example/large.png",
    );
  });

  it("rejects non-http(s) cover URLs", () => {
    const payload = {
      image: [{ size: "large", "#text": "javascript:alert(1)" }],
    };
    expect(lastfmPreferredCoverImageUrlFromWirePayload(payload)).toBeNull();
  });
});
