import { describe, expect, it } from "vitest";
import { parseVsSessionCookie } from "./parse-vs-session-cookie";

describe("parseVsSessionCookie", () => {
  it("returns the token from a single Set-Cookie line", () => {
    expect(
      parseVsSessionCookie([
        "vs_session=opaque-token-123; Path=/; HttpOnly; SameSite=Lax",
      ]),
    ).toBe("opaque-token-123");
  });

  it("returns the first vs_session when multiple cookies are present", () => {
    expect(
      parseVsSessionCookie([
        "other=value; Path=/",
        "vs_session=first; Path=/",
        "vs_session=second; Path=/",
      ]),
    ).toBe("first");
  });

  it("returns null when vs_session is absent", () => {
    expect(parseVsSessionCookie(["other=value; Path=/"])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(parseVsSessionCookie([])).toBeNull();
  });
});
