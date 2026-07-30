import { beforeEach, describe, expect, it, vi } from "vitest";

const hoistedInvalidate = vi.hoisted(() => vi.fn());

vi.mock("@/server/listening-history-read-cache-invalidation", () => ({
  invalidateListeningHistoryDerivedReadCaches: hoistedInvalidate,
}));

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
  return new Request("http://localhost/api/internal/cache/invalidate-user-read-cache", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/cache/invalidate-user-read-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedLoadEnv.mockReturnValue({
      VS_INTERNAL_API_SECRET: "x".repeat(32),
    });
  });

  it("returns 503 when VS_INTERNAL_API_SECRET is unset", async () => {
    hoistedLoadEnv.mockReturnValue({ VS_INTERNAL_API_SECRET: undefined });
    const out = await POST(
      postRequest(
        { user_id: USER_ID },
        { authorization: `Bearer ${"x".repeat(32)}` },
      ),
    );
    expect(out.status).toBe(503);
    expect(await out.json()).toMatchObject({ code: "internal_api_disabled" });
    expect(hoistedInvalidate).not.toHaveBeenCalled();
  });

  it("returns 403 when the bearer token is wrong", async () => {
    const out = await POST(
      postRequest(
        { user_id: USER_ID },
        { authorization: "Bearer wrong-secret-wrong-secret-wrong" },
      ),
    );
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ code: "internal_api_forbidden" });
    expect(hoistedInvalidate).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid user_id", async () => {
    const out = await POST(
      postRequest(
        { user_id: "not-a-uuid" },
        { authorization: `Bearer ${"x".repeat(32)}` },
      ),
    );
    expect(out.status).toBe(400);
    expect(hoistedInvalidate).not.toHaveBeenCalled();
  });

  it("invokes centralized invalidation for a valid user_id", async () => {
    const out = await POST(
      postRequest({ user_id: USER_ID }, { authorization: `Bearer ${"x".repeat(32)}` }),
    );
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true, user_id: USER_ID });
    expect(hoistedInvalidate).toHaveBeenCalledTimes(1);
    expect(hoistedInvalidate).toHaveBeenCalledWith(USER_ID);
  });
});
