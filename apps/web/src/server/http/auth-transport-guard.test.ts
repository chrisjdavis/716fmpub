import { describe, expect, it } from "vitest";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";

describe("rejectUnlessTrustedAuthTransport", () => {
  it("allows non-strict deploys without inspecting Host", () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { host: "localhost" },
    });
    expect(
      rejectUnlessTrustedAuthTransport(req, {
        deployEnv: "development",
        publicAppOrigin: undefined,
        trustProxyHeaders: false,
      }),
    ).toBeNull();
  });

  it("returns 403 when strict Host does not match public origin", () => {
    const req = new Request("https://app.example.com/api/auth/login", {
      method: "POST",
      headers: { host: "evil.example" },
    });
    const res = rejectUnlessTrustedAuthTransport(req, {
      deployEnv: "production",
      publicAppOrigin: "https://app.example.com",
      trustProxyHeaders: false,
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns 403 when Origin is present and does not match in strict mode", () => {
    const req = new Request("https://app.example.com/api/auth/login", {
      method: "POST",
      headers: {
        host: "app.example.com",
        origin: "https://evil.example",
      },
    });
    const res = rejectUnlessTrustedAuthTransport(req, {
      deployEnv: "staging",
      publicAppOrigin: "https://app.example.com",
      trustProxyHeaders: true,
    });
    expect(res!.status).toBe(403);
  });

  it("allows strict requests when Host and optional Origin match", () => {
    const req = new Request("https://app.example.com/api/auth/login", {
      method: "POST",
      headers: {
        host: "app.example.com",
        origin: "https://app.example.com",
      },
    });
    expect(
      rejectUnlessTrustedAuthTransport(req, {
        deployEnv: "production",
        publicAppOrigin: "https://app.example.com",
        trustProxyHeaders: false,
      }),
    ).toBeNull();
  });
});
