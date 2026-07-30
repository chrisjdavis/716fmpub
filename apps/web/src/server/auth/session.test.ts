import { describe, expect, it, vi } from "vitest";
import { hashSessionToken, newSessionToken } from "./session-token";
import {
  SESSION_POLICY,
  createDbSession,
  destroySessionByRawToken,
  invalidatePriorSessionsForAuthTransition,
  sessionCookieMaxAgeSec,
  validateSession,
} from "./session";

describe("session", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const email = "u@test.dev";

  const fixedNow = Date.UTC(2026, 0, 15, 12, 0, 0);
  const validExpiresAt = new Date(fixedNow + 86_400_000).toISOString();
  const validLastSeenAt = new Date(fixedNow).toISOString();

  function sessionRow(overrides: Partial<{
    id: string;
    user_id: string;
    email: string;
    email_verified_at: string | null;
    account_role: string;
    account_status: string;
    product_plan: string;
    last_rotated_at: string;
    expires_at: string;
    last_seen_at: string;
  }> = {}) {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: userId,
      email,
      email_verified_at: new Date(fixedNow).toISOString(),
      account_role: "user",
      account_status: "active",
      product_plan: "core",
      last_rotated_at: new Date(fixedNow).toISOString(),
      expires_at: validExpiresAt,
      last_seen_at: validLastSeenAt,
      ...overrides,
    };
  }

  it("sessionCookieMaxAgeSec matches absolute TTL", () => {
    expect(sessionCookieMaxAgeSec()).toBe(Math.floor(SESSION_POLICY.absoluteTtlMs / 1000));
  });

  it("validateSession returns null when no matching row", async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    const raw = newSessionToken();
    await expect(validateSession(pool, raw, "rsc")).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("validateSession returns null when expires_at is not after nowMs (absolute expiry)", async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          sessionRow({
            expires_at: new Date(fixedNow - 1000).toISOString(),
          }),
        ],
      }),
    };
    const raw = newSessionToken();
    await expect(validateSession(pool, raw, "rsc", fixedNow)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("validateSession returns null when last_seen_at is outside the idle window", async () => {
    const staleLastSeen = new Date(
      fixedNow - SESSION_POLICY.idleTimeoutMs - 60_000,
    ).toISOString();
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [sessionRow({ last_seen_at: staleLastSeen })],
      }),
    };
    const raw = newSessionToken();
    await expect(validateSession(pool, raw, "rsc", fixedNow)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("validateSession returns null when product_plan is not a known value and revokes the session row", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ product_plan: "enterprise" })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    await expect(validateSession(pool, raw, "rsc", fixedNow)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(String(pool.query.mock.calls[1][0])).toContain("delete from sessions");
  });

  it("validateSession maps users.product_plan from the joined row onto AuthenticatedUser.productPlan", async () => {
    const lastRotated = new Date(fixedNow).toISOString();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ product_plan: "advanced", last_rotated_at: lastRotated })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    const result = await validateSession(pool, raw, "rsc", fixedNow);
    expect(result).toEqual({
      user: {
        id: userId,
        email,
        emailVerified: true,
        accountRole: "user",
        productPlan: "advanced",
      },
    });
  });

  it("validateSession returns null when account_status is not active and revokes the session row", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ account_status: "suspended" })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    await expect(validateSession(pool, raw, "rsc", fixedNow)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(String(pool.query.mock.calls[1][0])).toContain("delete from sessions");
  });

  it("validateSession touches last_seen when rotation is not due", async () => {
    const lastRotated = new Date(fixedNow).toISOString();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ last_rotated_at: lastRotated })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    const result = await validateSession(pool, raw, "rsc", fixedNow);
    expect(result).toEqual({
      user: { id: userId, email, emailVerified: true, accountRole: "user", productPlan: "core" },
    });
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(String(pool.query.mock.calls[1][0])).toContain("last_seen_at");
  });

  it("validateSession in api mode rotates when last_rotated_at exceeds interval", async () => {
    const lastRotated = new Date(
      fixedNow - SESSION_POLICY.rotationIntervalMs - 1000,
    ).toISOString();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ last_rotated_at: lastRotated })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    const result = await validateSession(pool, raw, "api", fixedNow);
    expect(result?.user).toEqual({
      id: userId,
      email,
      emailVerified: true,
      accountRole: "user",
      productPlan: "core",
    });
    expect(result?.rotatedRawToken).toBeDefined();
    expect(result?.rotatedRawToken).not.toBe(raw);
    expect(String(pool.query.mock.calls[1][0])).toContain("token_hash");
  });

  it("validateSession does not rotate in rsc mode even when interval elapsed", async () => {
    const lastRotated = new Date(
      fixedNow - SESSION_POLICY.rotationIntervalMs - 1000,
    ).toISOString();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ last_rotated_at: lastRotated })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    const result = await validateSession(pool, raw, "rsc", fixedNow);
    expect(result).toEqual({
      user: { id: userId, email, emailVerified: true, accountRole: "user", productPlan: "core" },
    });
    expect(String(pool.query.mock.calls[1][0])).toContain("last_seen_at");
    expect(String(pool.query.mock.calls[1][0])).not.toContain("token_hash = $2");
  });

  it("createDbSession inserts session row with expiry", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const out = await createDbSession(pool, userId);
    expect(out.rawToken.length).toBeGreaterThan(10);
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into sessions"),
      expect.arrayContaining([userId, hashSessionToken(out.rawToken)]),
    );
  });

  it("destroySessionByRawToken deletes by token hash", async () => {
    const raw = newSessionToken();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await destroySessionByRawToken(pool, raw);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("delete from sessions"),
      [hashSessionToken(raw)],
    );
  });

  it("invalidatePriorSessionsForAuthTransition deletes request token then all user sessions", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const token = newSessionToken();
    await invalidatePriorSessionsForAuthTransition(pool, {
      userId,
      requestSessionRawToken: token,
    });
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("delete from sessions"),
      [hashSessionToken(token)],
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("user_id = $1::uuid"),
      [userId],
    );
  });

  it("invalidatePriorSessionsForAuthTransition skips token delete when absent", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await invalidatePriorSessionsForAuthTransition(pool, { userId });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("user_id = $1::uuid"),
      [userId],
    );
  });

  it("invalidatePriorSessionsForAuthTransition treats blank request token as absent", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await invalidatePriorSessionsForAuthTransition(pool, {
      userId,
      requestSessionRawToken: "   ",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("validateSession marks emailVerified false when email_verified_at is null", async () => {
    const lastRotated = new Date(fixedNow).toISOString();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [sessionRow({ email_verified_at: null, last_rotated_at: lastRotated })],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const raw = newSessionToken();
    const result = await validateSession(pool, raw, "rsc", fixedNow);
    expect(result).toEqual({
      user: { id: userId, email, emailVerified: false, accountRole: "user", productPlan: "core" },
    });
  });

  it("validateSession returns null for a token removed by invalidatePriorSessionsForAuthTransition", async () => {
    const oldRaw = newSessionToken();
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    await invalidatePriorSessionsForAuthTransition(pool, {
      userId,
      requestSessionRawToken: oldRaw,
    });
    await expect(validateSession(pool, oldRaw, "api")).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
