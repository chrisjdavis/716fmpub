import { describe, expect, it } from "vitest";
import {
  hostHeaderToUrlHost,
  originHeaderMatchesPublicApp,
  requestUsesHttps,
} from "@/server/http/request-transport";

describe("requestUsesHttps", () => {
  it("returns true when Next URL is already https", () => {
    const url = new URL("https://app.example.com/api/me");
    const headers = new Headers({ "x-forwarded-proto": "http" });
    expect(requestUsesHttps(url, headers, true)).toBe(true);
  });

  it("returns false when URL is http and trustProxy is false even if x-forwarded-proto is https", () => {
    const url = new URL("http://127.0.0.1:3456/api/me");
    const headers = new Headers({ "x-forwarded-proto": "https" });
    expect(requestUsesHttps(url, headers, false)).toBe(false);
  });

  it("honors x-forwarded-proto when trustProxy is true", () => {
    const url = new URL("http://127.0.0.1:3456/api/me");
    const headers = new Headers({ "x-forwarded-proto": "https" });
    expect(requestUsesHttps(url, headers, true)).toBe(true);
  });
});

describe("hostHeaderToUrlHost", () => {
  it("lowercases host for comparison", () => {
    expect(hostHeaderToUrlHost("App.EXAMPLE.com", "https")).toBe("app.example.com");
  });
});

describe("originHeaderMatchesPublicApp", () => {
  it("treats missing Origin as absent", () => {
    const headers = new Headers();
    expect(originHeaderMatchesPublicApp(headers, "https://app.example.com")).toBe("absent");
  });

  it("accepts a matching Origin", () => {
    const headers = new Headers({ origin: "https://app.example.com" });
    expect(originHeaderMatchesPublicApp(headers, "https://app.example.com/")).toBe("ok");
  });

  it("rejects a different Origin", () => {
    const headers = new Headers({ origin: "https://evil.example" });
    expect(originHeaderMatchesPublicApp(headers, "https://app.example.com")).toBe("mismatch");
  });
});
