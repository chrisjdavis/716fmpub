import { beforeEach, describe, expect, it, vi } from "vitest";

const hoistedQuery = vi.hoisted(() => vi.fn());

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({
      query: hoistedQuery,
    })),
    runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
      fn(),
  };
});

const hoistedLoadEnv = vi.hoisted(() =>
  vi.fn(() => ({
    VS_INTERNAL_API_SECRET: "x".repeat(32),
  })),
);

vi.mock("@vs/env", () => ({
  loadServerEnv: hoistedLoadEnv,
}));

import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function postRequest(
  body: unknown,
  init?: { authorization?: string },
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init?.authorization !== undefined) {
    headers.set("authorization", init.authorization);
  }
  return new Request(
    "http://localhost/api/internal/analytics/dashboard-default-snapshot",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/internal/analytics/dashboard-default-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedLoadEnv.mockReturnValue({
      VS_INTERNAL_API_SECRET: "x".repeat(32),
    });
    hoistedQuery.mockResolvedValue({
      rows: [{ updated_at: "2020-01-01T00:00:00.000Z" }],
    });
  });

  it("returns 503 when VS_INTERNAL_API_SECRET is unset", async () => {
    hoistedLoadEnv.mockReturnValue({ VS_INTERNAL_API_SECRET: undefined });
    const out = await POST(
      postRequest(
        { user_id: USER_ID, body: { a: 1 } },
        { authorization: `Bearer ${"x".repeat(32)}` },
      ),
    );
    expect(out.status).toBe(503);
    expect(await out.json()).toMatchObject({ code: "internal_api_disabled" });
    expect(hoistedQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when the bearer token is wrong", async () => {
    const out = await POST(
      postRequest(
        { user_id: USER_ID, body: { a: 1 } },
        { authorization: "Bearer wrong-secret-wrong-secret-wrong" },
      ),
    );
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ code: "internal_api_forbidden" });
    expect(hoistedQuery).not.toHaveBeenCalled();
  });

  it("upserts when bearer matches", async () => {
    const secret = "y".repeat(32);
    hoistedLoadEnv.mockReturnValue({ VS_INTERNAL_API_SECRET: secret });
    const out = await POST(
      postRequest(
        { user_id: USER_ID, body: { totals: 3 } },
        { authorization: `Bearer ${secret}` },
      ),
    );
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({
      kind: "dashboard_default",
      user_id: USER_ID,
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    expect(hoistedQuery).toHaveBeenCalledTimes(1);
  });
});
