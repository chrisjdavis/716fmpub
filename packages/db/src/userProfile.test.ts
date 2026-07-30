import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUserLastfmApiKey,
  getUserProfileFields,
  updateUserProfileFields,
} from "./userProfile.js";

describe("userProfile repository", () => {
  const query = vi.fn();
  const db = { query };

  beforeEach(() => {
    query.mockReset();
  });

  it("getUserProfileFields returns row", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          display_name: "Ada",
          lastfm_username: "adalast",
          has_lastfm_api_key: true,
          stats_timezone: null,
        },
      ],
    });
    const out = await getUserProfileFields(db as never, "u1");
    expect(out).toEqual({
      display_name: "Ada",
      lastfm_username: "adalast",
      has_lastfm_api_key: true,
      stats_timezone: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("select display_name"),
      ["u1"],
    );
  });

  it("getUserProfileFields returns null when user missing", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await getUserProfileFields(db as never, "missing");
    expect(out).toBeNull();
  });

  it("updateUserProfileFields updates both columns when both provided", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await updateUserProfileFields(db as never, "u1", {
      displayName: "N",
      lastfmUsername: "lf",
    });
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toContain("display_name = $1");
    expect(String(sql)).toContain("lastfm_username = $2");
    expect(String(sql)).toContain("updated_at = now()");
    expect(String(sql)).toContain("where id = $3::uuid");
    expect(params).toEqual(["N", "lf", "u1"]);
  });

  it("updateUserProfileFields clears with null", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await updateUserProfileFields(db as never, "u1", {
      displayName: null,
      lastfmUsername: null,
    });
    const params = query.mock.calls[0]?.[1];
    expect(params).toEqual([null, null, "u1"]);
  });

  it("updateUserProfileFields is a no-op when no keys", async () => {
    await updateUserProfileFields(db as never, "u1", {});
    expect(query).not.toHaveBeenCalled();
  });

  it("updateUserProfileFields can patch display name only", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await updateUserProfileFields(db as never, "u1", { displayName: "Only" });
    const params = query.mock.calls[0]?.[1];
    expect(params).toEqual(["Only", "u1"]);
  });

  it("getUserLastfmApiKey returns trimmed secret", async () => {
    query.mockResolvedValueOnce({
      rows: [{ lastfm_api_key: "  abc123  " }],
    });
    const out = await getUserLastfmApiKey(db as never, "u1");
    expect(out).toBe("abc123");
  });

  it("getUserLastfmApiKey returns null for empty stored value", async () => {
    query.mockResolvedValueOnce({
      rows: [{ lastfm_api_key: "   " }],
    });
    const out = await getUserLastfmApiKey(db as never, "u1");
    expect(out).toBeNull();
  });

  it("updateUserProfileFields can set lastfmApiKey", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await updateUserProfileFields(db as never, "u1", { lastfmApiKey: "k1" });
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toContain("lastfm_api_key = $1");
    expect(params).toEqual(["k1", "u1"]);
  });
});
