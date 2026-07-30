import { describe, expect, it } from "vitest";
import { parseVsCsrfCookie } from "./parse-vs-csrf-cookie";

describe("parseVsCsrfCookie", () => {
  it("returns the token from a single Set-Cookie line", () => {
    expect(
      parseVsCsrfCookie([
        "vs_csrf=abc%2B123; Path=/; SameSite=Lax",
      ]),
    ).toBe("abc+123");
  });

  it("returns null when vs_csrf is absent", () => {
    expect(parseVsCsrfCookie(["vs_session=x; Path=/"])).toBeNull();
  });
});
