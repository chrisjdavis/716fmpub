import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME, API_CSRF_HEADER_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedDb = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  deleteUserAccount: vi.fn(),
  insertSecurityAuditEvent: vi.fn(),
  tryInsertSecurityAuditEvent: vi.fn(),
  withConsumedStepUpToken: vi.fn(),
}));

const hoistedSession = vi.hoisted(() => ({
  readSessionRawToken: vi.fn(),
  validateSession: vi.fn(),
}));

const hoistedQueue = vi.hoisted(() => ({
  close: vi.fn(),
  removeUserJobsFromQueue: vi.fn(),
}));

const hoistedFs = vi.hoisted(() => ({
  unlink: vi.fn(),
}));

const hoistedInvalidate = vi.hoisted(() => vi.fn());

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({ query: hoistedDb.poolQuery })),
    deleteUserAccount: hoistedDb.deleteUserAccount,
    insertSecurityAuditEvent: hoistedDb.insertSecurityAuditEvent,
    tryInsertSecurityAuditEvent: hoistedDb.tryInsertSecurityAuditEvent,
    withConsumedStepUpToken: hoistedDb.withConsumedStepUpToken,
  };
});

vi.mock("@vs/queue", () => ({
  createImportsQueue: vi.fn(() => ({ close: hoistedQueue.close })),
  createIncrementalSyncQueue: vi.fn(() => ({ close: hoistedQueue.close })),
  createSyncQueue: vi.fn(() => ({ close: hoistedQueue.close })),
  createAnalyticsQueue: vi.fn(() => ({ close: hoistedQueue.close })),
  createExportsQueue: vi.fn(() => ({ close: hoistedQueue.close })),
  removeUserJobsFromQueue: hoistedQueue.removeUserJobsFromQueue,
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    deployEnv: "test",
    EXPORT_ARTIFACTS_DIR: "/tmp/vs-artifacts",
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    readSessionRawToken: hoistedSession.readSessionRawToken,
    validateSession: hoistedSession.validateSession,
  };
});

vi.mock("node:fs/promises", () => ({
  unlink: hoistedFs.unlink,
}));

vi.mock("@/server/listening-history-read-cache-invalidation", () => ({
  invalidateListeningHistoryDerivedReadCaches: hoistedInvalidate,
}));

import { cookies } from "next/headers";
import { DELETE_USER_ACCOUNT_CONFIRM_PHRASE, STEP_UP_PURPOSE_DELETE_ACCOUNT } from "@vs/db";
import { DELETE } from "./route";

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "a@example.com",
  emailVerified: true,
  accountRole: "user" as const,
  productPlan: "core" as const,
};

function deleteWithCsrf(body: unknown): Request {
  const csrf = "csrf-proof-token";
  return new Request("http://localhost/api/me", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      [API_CSRF_HEADER_NAME]: csrf,
    },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const csrf = "csrf-proof-token";
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({ user: USER });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: csrf } : undefined,
    } as never);
    hoistedQueue.close.mockResolvedValue(undefined);
    hoistedQueue.removeUserJobsFromQueue.mockResolvedValue({
      inspected: 1,
      removed: 1,
      notRemoved: 0,
    });
    hoistedDb.insertSecurityAuditEvent.mockResolvedValue({ id: "audit" });
    hoistedDb.deleteUserAccount.mockResolvedValue({
      userDeleted: true,
      listensDeleted: 2,
      rawScrobblesDeleted: 3,
      importJobsDeleted: 1,
      exportJobsDeleted: 1,
      analyticsSnapshotsDeleted: 4,
      exportArtifactRelativePaths: [`${USER.id}/export.zip`],
    });
    hoistedDb.withConsumedStepUpToken.mockImplementation(
      async (
        _pool: unknown,
        _args: unknown,
        run: (client: { query: typeof hoistedDb.poolQuery }) => Promise<unknown>,
      ) => ({ ok: true, value: await run({ query: hoistedDb.poolQuery }) }),
    );
    hoistedFs.unlink.mockResolvedValue(undefined);
  });

  it("deletes the account, clears auth cookies, and unlinks export artifacts", async () => {
    const res = await DELETE(
      deleteWithCsrf({
        confirmPhrase: DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );

    expect(res.status).toBe(200);
    expect(hoistedDb.withConsumedStepUpToken).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: USER.id,
        purpose: STEP_UP_PURPOSE_DELETE_ACCOUNT,
        rawToken: "tok",
      },
      expect.any(Function),
    );
    expect(hoistedDb.deleteUserAccount).toHaveBeenCalledWith(expect.anything(), USER.id);
    expect(hoistedFs.unlink).toHaveBeenCalledWith(`/tmp/vs-artifacts/${USER.id}/export.zip`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
    const body = (await res.json()) as { ok?: boolean; deleted?: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.deleted?.queuedJobsRemoved).toBe(5);
  });

  it("rejects a mismatched confirmation phrase before consuming step-up", async () => {
    const res = await DELETE(
      deleteWithCsrf({
        confirmPhrase: "delete me",
        stepUpToken: "tok",
      }),
    );

    expect(res.status).toBe(400);
    expect(hoistedDb.withConsumedStepUpToken).not.toHaveBeenCalled();
    expect(hoistedDb.deleteUserAccount).not.toHaveBeenCalled();
  });

  it("does not remove queued work when step-up consumption fails", async () => {
    hoistedDb.withConsumedStepUpToken.mockResolvedValueOnce({
      ok: false,
      reason: "expired",
    });

    const res = await DELETE(
      deleteWithCsrf({
        confirmPhrase: DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );

    expect(res.status).toBe(403);
    expect(hoistedQueue.removeUserJobsFromQueue).not.toHaveBeenCalled();
    expect(hoistedDb.deleteUserAccount).not.toHaveBeenCalled();
  });

  it("blocks deletion when active queue work cannot be removed", async () => {
    hoistedQueue.removeUserJobsFromQueue.mockResolvedValueOnce({
      inspected: 1,
      removed: 0,
      notRemoved: 1,
    });

    const res = await DELETE(
      deleteWithCsrf({
        confirmPhrase: DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("account_delete_active_work");
    expect(hoistedDb.deleteUserAccount).not.toHaveBeenCalled();
  });
});
