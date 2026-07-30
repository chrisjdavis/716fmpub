import { describe, expect, it } from "vitest";
import { meProfilePatchBodySchema } from "./me-profile-patch";

describe("meProfilePatchBodySchema", () => {
  it("accepts display name and lastfm username", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "  Ada  ",
      lastfmUsername: "lastfm_user",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.displayName).toBe("Ada");
      expect(out.data.lastfmUsername).toBe("lastfm_user");
      expect(out.data.lastfmApiKey).toBeUndefined();
    }
  });

  it("accepts optional lastfmApiKey", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      lastfmApiKey: "  12345678  ",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.lastfmApiKey).toBe("12345678");
    }
  });

  it("maps blank lastfmApiKey string to null", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      lastfmApiKey: "  ",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.lastfmApiKey).toBeNull();
    }
  });

  it("rejects lastfmApiKey shorter than 8 chars when non-null", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      lastfmApiKey: "short",
    });
    expect(out.success).toBe(false);
  });

  it("maps blank strings to null", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "   ",
      lastfmUsername: "",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.displayName).toBeNull();
      expect(out.data.lastfmUsername).toBeNull();
    }
  });

  it("rejects missing keys", () => {
    const out = meProfilePatchBodySchema.safeParse({ displayName: "x" });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      isAdmin: true,
    });
    expect(out.success).toBe(false);
  });

  it("rejects lastfm username over 64 chars", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "ok",
      lastfmUsername: "a".repeat(65),
    });
    expect(out.success).toBe(false);
  });

  it("rejects display name over 120 chars", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "a".repeat(121),
      lastfmUsername: "ok",
    });
    expect(out.success).toBe(false);
  });

  it("accepts optional statsTimezone when valid IANA", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      statsTimezone: "America/New_York",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.statsTimezone).toBe("America/New_York");
    }
  });

  it("accepts optional listeningHistoryPublic", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      listeningHistoryPublic: true,
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.listeningHistoryPublic).toBe(true);
    }
  });

  it("rejects invalid statsTimezone", () => {
    const out = meProfilePatchBodySchema.safeParse({
      displayName: "x",
      lastfmUsername: "u",
      statsTimezone: "Not/A/Zone",
    });
    expect(out.success).toBe(false);
  });
});
