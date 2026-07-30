import { describe, expect, it, vi } from "vitest";

import {
  devVerboseInfo,
  isSensitiveKeyName,
  redactForLogLine,
  redactUnknownStructured,
  summarizeThrowableForLog,
} from "./log-redaction.js";

describe("redactForLogLine", () => {
  it("redacts postgres URLs with credentials", () => {
    const raw =
      "connect failed postgres://alice:hunter2@db.internal:5432/app?sslmode=require end";
    const out = redactForLogLine(raw);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("alice:");
    expect(out).toContain("postgres://[REDACTED]");
  });

  it("redacts redis URLs", () => {
    const raw = "bad redis://:s3cr3t@redis:6379/0 tail";
    expect(redactForLogLine(raw)).not.toContain("s3cr3t");
    expect(redactForLogLine(raw)).toContain("redis://[REDACTED]");
  });

  it("redacts Authorization header spans (single-line logs)", () => {
    const out = redactForLogLine("note Authorization: Bearer abc.def.ghi tail");
    expect(out).toBe("note Authorization: [REDACTED]");
  });

  it("redacts standalone JWT-shaped strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactForLogLine(`ws token ${jwt} done`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[REDACTED_JWT]");
  });

  it("redacts Cookie and Authorization header fragments in text", () => {
    const raw = "x Cookie: sid=supersecret; Path=/ y Authorization: Basic dGVzdA== z";
    const out = redactForLogLine(raw);
    expect(out).not.toContain("supersecret");
    expect(out).not.toContain("dGVzdA==");
    expect(out).toContain("Cookie: [REDACTED]");
    expect(out).not.toMatch(/Basic\s+dGVzdA/);
  });
});

describe("redactUnknownStructured", () => {
  it("redacts sensitive keys and nested secrets", () => {
    const input = {
      userId: "u1",
      password: "hunter2",
      nested: { apiKey: "k-9", ok: "fine" },
      token: "abc",
    };
    const out = redactUnknownStructured(input) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe("fine");
    expect(out.userId).toBe("u1");
  });

  it("redacts URL-like strings inside values", () => {
    const out = redactUnknownStructured({
      msg: "see postgres://u:p@h/db",
    }) as Record<string, unknown>;
    expect(String(out.msg)).not.toContain("p@h");
    expect(String(out.msg)).toContain("postgres://[REDACTED]");
  });
});

describe("isSensitiveKeyName", () => {
  it("matches representative auth and credential field names", () => {
    expect(isSensitiveKeyName("password")).toBe(true);
    expect(isSensitiveKeyName("access_token")).toBe(true);
    expect(isSensitiveKeyName("refreshToken")).toBe(true);
    expect(isSensitiveKeyName("LASTFM_API_KEY")).toBe(true);
    expect(isSensitiveKeyName("lastfmApiKey")).toBe(true);
    expect(isSensitiveKeyName("displayName")).toBe(false);
  });
});

describe("summarizeThrowableForLog", () => {
  it("returns type and redacted message without stack", () => {
    const err = new Error("failed postgres://x:y@z/db");
    const s = summarizeThrowableForLog(err);
    expect(s.errorType).toBe("Error");
    expect(s.message).toContain("postgres://[REDACTED]");
    expect(s.message).not.toContain("y@z");
    expect(JSON.stringify(s)).not.toContain("stack");
  });
});

describe("devVerboseInfo", () => {
  it("is a no-op for strict deploy environments (production)", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const prevNode = process.env.NODE_ENV;
    const prevVs = process.env.VS_DEPLOY_ENV;
    process.env.NODE_ENV = "production";
    process.env.VS_DEPLOY_ENV = "production";
    devVerboseInfo("should not log");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    process.env.NODE_ENV = prevNode;
    process.env.VS_DEPLOY_ENV = prevVs;
  });

  it("is a no-op when VS_DEPLOY_ENV is staging even if NODE_ENV is development", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const prevNode = process.env.NODE_ENV;
    const prevVs = process.env.VS_DEPLOY_ENV;
    process.env.NODE_ENV = "development";
    process.env.VS_DEPLOY_ENV = "staging";
    devVerboseInfo("should not log");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    process.env.NODE_ENV = prevNode;
    process.env.VS_DEPLOY_ENV = prevVs;
  });

  it("logs in local development deploy", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const prevNode = process.env.NODE_ENV;
    const prevVs = process.env.VS_DEPLOY_ENV;
    process.env.NODE_ENV = "development";
    delete process.env.VS_DEPLOY_ENV;
    devVerboseInfo("x", { y: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    process.env.NODE_ENV = prevNode;
    if (prevVs === undefined) {
      delete process.env.VS_DEPLOY_ENV;
    } else {
      process.env.VS_DEPLOY_ENV = prevVs;
    }
  });
});
