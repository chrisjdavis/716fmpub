import { afterEach, describe, expect, it } from "vitest";
import nock from "nock";

import { lookupLastfmUsername, LASTFM_ERROR_USER_NOT_FOUND } from "./validateUsername.js";

describe("lookupLastfmUsername", () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it("returns invalid_username when Last.fm reports user not found", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query(true)
      .reply(200, {
        error: LASTFM_ERROR_USER_NOT_FOUND,
        message: "User not found",
      });

    const result = await lookupLastfmUsername({
      apiKey: "test-key",
      username: "definitely_missing_user_xyz",
    });

    expect(result).toEqual({
      ok: false,
      kind: "invalid_username",
      message: "User not found",
    });
  });

  it("returns ok when user payload is present", async () => {
    nock("https://ws.audioscrobbler.com")
      .get("/2.0/")
      .query(true)
      .reply(200, { user: { name: "RJ" } });

    const result = await lookupLastfmUsername({
      apiKey: "test-key",
      username: "RJ",
    });

    expect(result).toEqual({ ok: true });
  });
});
