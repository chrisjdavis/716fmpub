import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(_opts: unknown) {}
    connect = connectMock;
  },
}));

describe("verifyDatabaseConnectivity", () => {
  beforeEach(async () => {
    vi.resetModules();
    connectMock.mockReset();
    process.env.VS_PERF_DB_QUERIES = "off";
  });

  it("returns structured failure when connect rejects", async () => {
    connectMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { verifyDatabaseConnectivity } = await import("./index.js");
    const result = await verifyDatabaseConnectivity({
      DATABASE_URL: "postgres://localhost:55432/app",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ECONNREFUSED");
    }
  });

  it("returns structured failure when query rejects", async () => {
    connectMock.mockResolvedValue({
      query: vi.fn().mockRejectedValue(new Error("query failed")),
      release: vi.fn(),
    });
    const { verifyDatabaseConnectivity } = await import("./index.js");
    const result = await verifyDatabaseConnectivity({
      DATABASE_URL: "postgres://localhost:55432/app",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("query failed");
    }
  });

  it("returns ok when connect and query succeed", async () => {
    connectMock.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      release: vi.fn(),
    });
    const { verifyDatabaseConnectivity } = await import("./index.js");
    const result = await verifyDatabaseConnectivity({
      DATABASE_URL: "postgres://localhost:55432/app",
    });
    expect(result.ok).toBe(true);
  });

  it("redacts credential-bearing URLs from failure reasons", async () => {
    connectMock.mockRejectedValue(
      new Error("bad conn postgres://u:secret@db:5432/x"),
    );
    const { verifyDatabaseConnectivity } = await import("./index.js");
    const result = await verifyDatabaseConnectivity({
      DATABASE_URL: "postgres://localhost:55432/app",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("secret");
      expect(result.reason).toContain("postgres://[REDACTED]");
    }
  });
});
