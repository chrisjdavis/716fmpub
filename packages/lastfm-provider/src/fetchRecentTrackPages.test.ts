import { afterEach, describe, expect, it } from "vitest";
import nock from "nock";

import { fetchLastfmRecentTrackPages } from "./fetchRecentTrackPages.js";
import { LastfmProviderApiError, LastfmProviderValidationError } from "./errors.js";
import { LASTFM_ERROR_USER_NOT_FOUND } from "./validateUsername.js";

function track(uts: string, name: string) {
  return {
    artist: { mbid: "", "#text": "Artist" },
    album: { mbid: "", "#text": "Album" },
    image: [],
    streamable: "0",
    date: { uts, "#text": "" },
    url: "",
    name,
    mbid: "",
    loved: "0",
  };
}

describe("fetchLastfmRecentTrackPages", () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it("rejects empty username before calling Last.fm", async () => {
    const gen = fetchLastfmRecentTrackPages({
      apiKey: "k",
      username: "   ",
    });
    await expect(gen.next()).rejects.toThrow(LastfmProviderValidationError);
  });

  it("throws LastfmUsernameNotFoundError when user.getinfo fails", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, {
        error: LASTFM_ERROR_USER_NOT_FOUND,
        message: "User not found",
      });

    const gen = fetchLastfmRecentTrackPages({
      apiKey: "test-key",
      username: "missing_user",
    });

    await expect(gen.next()).rejects.toMatchObject({
      name: "LastfmUsernameNotFoundError",
      message: "User not found",
    });
  });

  it("yields mapped pages from scrobbles RecentTracks then stops", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, { user: { name: "u" } });

    let recentCalls = 0;
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .twice()
      .reply(200, () => {
        recentCalls += 1;
        if (recentCalls === 1) {
          return {
            recenttracks: {
              "@attr": {
                user: "u",
                total: "2",
                page: "1",
                perPage: "2",
                totalPages: "1",
              },
              track: [track("100", "A"), track("90", "B")],
            },
          };
        }
        return {
          recenttracks: {
            "@attr": {
              user: "u",
              total: "0",
              page: "1",
              perPage: "2",
              totalPages: "0",
            },
          },
        };
      });

    const pages: string[][] = [];
    for await (const page of fetchLastfmRecentTrackPages({
      apiKey: "key",
      username: "u",
      limitPerPage: 2,
      maxRetries: 1,
    })) {
      pages.push(page.map((e) => e.trackName));
    }

    expect(pages).toEqual([["A", "B"]]);
    expect(recentCalls).toBe(2);
  });

  it("maps a single-track Last.fm page and ignores now-playing rows without date", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, { user: { name: "u" } });

    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .reply(200, {
        recenttracks: {
          "@attr": {
            user: "u",
            total: "1",
            page: "1",
            perPage: "2",
            totalPages: "1",
          },
          track: track("100", "A"),
        },
      })
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .reply(200, {
        recenttracks: {
          "@attr": {
            user: "u",
            total: "0",
            page: "1",
            perPage: "2",
            totalPages: "0",
          },
          track: [{ ...track("120", "Now"), date: undefined }],
        },
      });

    const pages: string[][] = [];
    for await (const page of fetchLastfmRecentTrackPages({
      apiKey: "key",
      username: "u",
      limitPerPage: 2,
      maxRetries: 1,
    })) {
      pages.push(page.map((e) => e.trackName));
    }

    expect(pages).toEqual([["A"]]);
  });

  it("throws a provider error for malformed recent tracks responses", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, { user: { name: "u" } });

    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .reply(200, { ok: true });

    const gen = fetchLastfmRecentTrackPages({
      apiKey: "key",
      username: "u",
      maxRetries: 0,
    });

    await expect(gen.next()).rejects.toMatchObject({
      name: "LastfmProviderApiError",
      message: "Last.fm recent tracks response missing recenttracks.@attr",
    });
  });

  it("surfaces Last.fm recent-tracks JSON errors instead of reading @attr", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, { user: { name: "u" } });

    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .reply(200, { error: 10, message: "Invalid API key" });

    const gen = fetchLastfmRecentTrackPages({
      apiKey: "key",
      username: "u",
      maxRetries: 0,
    });

    await expect(gen.next()).rejects.toMatchObject({
      name: "LastfmProviderApiError",
      message: "Invalid API key",
      lastfmError: 10,
    });
  });

  it("does not retry permanent Last.fm JSON errors even when maxRetries > 0", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getinfo")
      .reply(200, { user: { name: "u" } });

    const scope = nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query((q) => q.method === "user.getrecenttracks")
      .reply(200, { error: 10, message: "Invalid API key" });

    const gen = fetchLastfmRecentTrackPages({
      apiKey: "key",
      username: "u",
      maxRetries: 5,
    });

    await expect(gen.next()).rejects.toMatchObject({
      name: "LastfmProviderApiError",
      lastfmError: 10,
    });
    expect(scope.isDone()).toBe(true);
  });
});
