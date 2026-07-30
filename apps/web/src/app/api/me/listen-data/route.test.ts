import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedListenPool = vi.hoisted(() => ({
  query: vi.fn((sql: string) => {
    if (sql.includes("insert into security_audit_events")) {
      return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
    }
    return Promise.resolve({ rows: [] });
  }),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({ query: hoistedListenPool.query })),
    purgeUserListenData: vi.fn(),
    withConsumedStepUpToken: vi.fn(),
  };
});

const hoistedRequireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/api/require-session")>();
  return {
    ...actual,
    requireSession: hoistedRequireSession,
    withApiSession: async (
      _req: Request,
      run: (ctx: {
        user: import("@/server/auth/session").AuthenticatedUser;
      }) => Promise<Response>,
    ) => {
      const gate = await hoistedRequireSession();
      if (!gate.ok) {
        return gate.response;
      }
      const res = await run({ user: gate.user });
      actual.applySessionRotationToResponse(gate, res);
      return res;
    },
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
}));

import {
  PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
  purgeUserListenData,
  withConsumedStepUpToken,
} from "@vs/db";
import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/me/listen-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/me/listen-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "u@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
    vi.mocked(withConsumedStepUpToken).mockResolvedValue({
      ok: true,
      value: {
        listensDeleted: 2,
        importJobsDeleted: 1,
        analyticsSnapshotsDeleted: 0,
      },
    });
    vi.mocked(purgeUserListenData).mockResolvedValue({
      listensDeleted: 0,
      importJobsDeleted: 0,
      analyticsSnapshotsDeleted: 0,
    });
  });

  it("returns 400 for unexpected JSON keys", async () => {
    const res = await POST(
      postJson({
        confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
        stepUpToken: "tok",
        force: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(withConsumedStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 400 when stepUpToken is missing", async () => {
    const res = await POST(
      postJson({
        confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
      }),
    );
    expect(res.status).toBe(400);
    expect(withConsumedStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 403 when step-up consumption fails", async () => {
    vi.mocked(withConsumedStepUpToken).mockResolvedValue({
      ok: false,
      reason: "expired",
    });
    const res = await POST(
      postJson({
        confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("step_up_expired");
    expect(purgeUserListenData).not.toHaveBeenCalled();
  });

  it("returns step_up_replayed when the token was already consumed", async () => {
    vi.mocked(withConsumedStepUpToken).mockResolvedValue({
      ok: false,
      reason: "replayed",
    });
    const res = await POST(
      postJson({
        confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("step_up_replayed");
  });

  it("returns 200 with deleted counts when step-up succeeds", async () => {
    const res = await POST(
      postJson({
        confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
        stepUpToken: "tok",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; deleted?: unknown };
    expect(body.ok).toBe(true);
    expect(body.deleted).toEqual({
      listensDeleted: 2,
      importJobsDeleted: 1,
      analyticsSnapshotsDeleted: 0,
    });
  });
});
