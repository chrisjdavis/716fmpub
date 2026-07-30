import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  readRealtimeWsUrlCandidatesFromEnv,
  wsOrHttpUrlToConnectSource,
} from "./browser-security-headers";

describe("wsOrHttpUrlToConnectSource", () => {
  it("normalizes wss URLs (default port omitted when URL normalizes it away)", () => {
    expect(wsOrHttpUrlToConnectSource("wss://rt.example.com:443/ws")).toBe("wss://rt.example.com");
  });

  it("retains non-default ws ports", () => {
    expect(wsOrHttpUrlToConnectSource("ws://127.0.0.1:4000")).toBe("ws://127.0.0.1:4000");
  });

  it("returns null for invalid input", () => {
    expect(wsOrHttpUrlToConnectSource("")).toBeNull();
    expect(wsOrHttpUrlToConnectSource("not-a-url")).toBeNull();
  });
});

describe("buildContentSecurityPolicy", () => {
  it("allows inline Next bootstrap scripts without enabling eval in production", () => {
    const dev = buildContentSecurityPolicy({
      nodeEnv: "development",
      realtimeWsUrlCandidates: [],
    });
    expect(dev).toContain("script-src 'self' 'unsafe-inline'");
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("http://127.0.0.1:*");
    expect(dev).not.toContain("upgrade-insecure-requests");

    const prod = buildContentSecurityPolicy({
      nodeEnv: "production",
      realtimeWsUrlCandidates: ["wss://rt.example.com/ws"],
      scriptNonce: "test-nonce-value",
    });
    expect(prod).toContain("script-src 'self' 'nonce-test-nonce-value' 'strict-dynamic' 'unsafe-inline'");
    expect(prod).toContain("https://static.cloudflareinsights.com");
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).toContain("https://cloudflareinsights.com");
    expect(prod).toContain("upgrade-insecure-requests");
    expect(prod).toContain("wss://rt.example.com");
    expect(prod).not.toContain("http://127.0.0.1:*");
  });

  it("includes frame-ancestors and object-src restrictions", () => {
    const csp = buildContentSecurityPolicy({
      nodeEnv: "production",
      realtimeWsUrlCandidates: [],
    });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("readRealtimeWsUrlCandidatesFromEnv", () => {
  it("collects public, internal, and port-derived URLs", () => {
    const list = readRealtimeWsUrlCandidatesFromEnv({
      NEXT_PUBLIC_LISTEN_REALTIME_WS_URL: "wss://edge.example/ws",
      LISTEN_REALTIME_WS_URL: "wss://internal.example/ws",
      LISTEN_REALTIME_PORT: "4000",
    });
    expect(list).toContain("wss://edge.example/ws");
    expect(list).toContain("wss://internal.example/ws");
    expect(list).toContain("ws://127.0.0.1:4000");
    expect(list).toContain("ws://localhost:4000");
  });

  it("dedupes when public and internal match", () => {
    const list = readRealtimeWsUrlCandidatesFromEnv({
      NEXT_PUBLIC_LISTEN_REALTIME_WS_URL: "wss://same/ws",
      LISTEN_REALTIME_WS_URL: "wss://same/ws",
    });
    expect(list.filter((u) => u === "wss://same/ws").length).toBe(1);
  });
});
