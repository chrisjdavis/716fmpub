import { beforeEach, describe, expect, it, vi } from "vitest";

const hoistedQuery = vi.hoisted(() => vi.fn());

vi.mock("@vs/db", () => ({
  getPool: vi.fn(() => ({
    query: hoistedQuery,
  })),
  listSecurityAuditEvents: vi.fn(),
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

const hoistedLoadEnv = vi.hoisted(() =>
  vi.fn(() => ({
    VS_INTERNAL_API_SECRET: "x".repeat(32),
  })),
);

vi.mock("@vs/env", () => ({
  loadServerEnv: hoistedLoadEnv,
}));

import { listSecurityAuditEvents } from "@vs/db";
import { GET } from "./route";

function getRequest(url: string, init?: { authorization?: string }): Request {
  const headers = new Headers();
  if (init?.authorization !== undefined) {
    headers.set("authorization", init.authorization);
  }
  return new Request(url, { method: "GET", headers });
}

describe("GET /api/internal/security/audit-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedLoadEnv.mockReturnValue({
      VS_INTERNAL_API_SECRET: "x".repeat(32),
    });
    vi.mocked(listSecurityAuditEvents).mockResolvedValue([
      {
        id: "e1",
        occurred_at: "2026-01-01T00:00:00.000Z",
        actor_user_id: null,
        action: "auth.login",
        outcome: "failure",
        metadata: {},
      },
    ]);
  });

  it("returns 503 when internal API secret is unset", async () => {
    hoistedLoadEnv.mockReturnValue({ VS_INTERNAL_API_SECRET: undefined });
    const res = await GET(
      getRequest("http://localhost/api/internal/security/audit-events", {
        authorization: `Bearer ${"x".repeat(32)}`,
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "internal_api_disabled" });
    expect(listSecurityAuditEvents).not.toHaveBeenCalled();
  });

  it("returns 403 when bearer token is wrong", async () => {
    const res = await GET(
      getRequest("http://localhost/api/internal/security/audit-events", {
        authorization: "Bearer wrong",
      }),
    );
    expect(res.status).toBe(403);
    expect(listSecurityAuditEvents).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed userId", async () => {
    const res = await GET(
      getRequest(
        "http://localhost/api/internal/security/audit-events?userId=not-a-uuid",
        { authorization: `Bearer ${"x".repeat(32)}` },
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_user_id" });
    expect(listSecurityAuditEvents).not.toHaveBeenCalled();
  });

  it("lists events when authorized", async () => {
    const secret = "y".repeat(32);
    hoistedLoadEnv.mockReturnValue({ VS_INTERNAL_API_SECRET: secret });
    const res = await GET(
      getRequest(
        "http://localhost/api/internal/security/audit-events?limit=5&userId=11111111-1111-4111-8111-111111111111",
        { authorization: `Bearer ${secret}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect(listSecurityAuditEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        limit: 5,
      }),
    );
  });
});
