import { DatabaseError } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    countActiveExportJobsForUser: vi.fn(),
    createExportJob: vi.fn(),
    getPool: vi.fn(() => ({ query: hoisted.poolQuery })),
    markExportJobFailedWhenQueued: vi.fn(),
    setExportJobBullmqJobId: vi.fn(),
  };
});

const hoisted = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockEnqueue: vi.fn(),
  poolQuery: vi.fn((sql: string) => {
    if (sql.includes("insert into security_audit_events")) {
      return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
    }
    return Promise.resolve({ rows: [] });
  }),
}));

vi.mock("@vs/queue", () => ({
  createExportsQueue: vi.fn(() => ({ close: hoisted.mockClose })),
  enqueueExportsJob: hoisted.mockEnqueue,
  EXPORTS_QUEUE_JOB_NAME: { USER_DATA_PACKAGE: "user_data_package" },
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
  isRedisQueuesEnabled: vi.fn(() => true),
}));

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

import {
  countActiveExportJobsForUser,
  createExportJob,
  markExportJobFailedWhenQueued,
  setExportJobBullmqJobId,
} from "@vs/db";
import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EXPORT_ID = "22222222-2222-4222-8222-222222222222";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/export/listens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/export/listens", () => {
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
    vi.mocked(countActiveExportJobsForUser).mockResolvedValue(0);
    vi.mocked(createExportJob).mockResolvedValue({ id: EXPORT_ID });
    hoisted.mockEnqueue.mockResolvedValue({ id: EXPORT_ID });
    hoisted.mockClose.mockResolvedValue(undefined);
    vi.mocked(markExportJobFailedWhenQueued).mockResolvedValue(undefined);
    vi.mocked(setExportJobBullmqJobId).mockResolvedValue(undefined);
  });

  it("returns 400 when the JSON body includes unexpected keys", async () => {
    const out = await POST(
      postRequest({ format: "json", includeDeleted: true }),
    );
    expect(out.status).toBe(400);
    expect(createExportJob).not.toHaveBeenCalled();
  });

  it("returns 409 when an export is already active (pre-check)", async () => {
    vi.mocked(countActiveExportJobsForUser).mockResolvedValue(1);
    const out = await POST(postRequest({ format: "json" }));
    expect(out.status).toBe(409);
    const body = await out.json();
    expect(body.code).toBe("export_already_queued_or_running");
    expect(createExportJob).not.toHaveBeenCalled();
  });

  it("returns 409 when createExportJob hits unique_violation (23505)", async () => {
    const dup = new DatabaseError("duplicate key", 10, "error");
    dup.code = "23505";
    vi.mocked(createExportJob).mockRejectedValueOnce(dup);
    const out = await POST(postRequest({ format: "json" }));
    expect(out.status).toBe(409);
    expect(await out.json()).toMatchObject({
      code: "export_already_queued_or_running",
    });
    expect(hoisted.mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 202 with export job id, queue job id, and status path", async () => {
    const out = await POST(postRequest({ format: "json" }));
    expect(out.status).toBe(202);
    expect(await out.json()).toEqual({
      exportJob: { id: EXPORT_ID },
      queueJob: { id: EXPORT_ID },
      statusPath: `/api/export/listens/${EXPORT_ID}`,
    });
    expect(hoisted.mockEnqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "user_data_package",
        data: { exportJobId: EXPORT_ID, userId: USER_ID },
      }),
      expect.objectContaining({ jobId: EXPORT_ID }),
    );
    expect(setExportJobBullmqJobId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        exportJobId: EXPORT_ID,
        userId: USER_ID,
        bullmqJobId: EXPORT_ID,
      }),
    );
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });

  it("returns 503, marks queued export failed, and closes the queue on enqueue error", async () => {
    hoisted.mockEnqueue.mockRejectedValue(new Error("redis down"));
    const out = await POST(postRequest({ format: "csv" }));
    expect(out.status).toBe(503);
    expect(markExportJobFailedWhenQueued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        exportJobId: EXPORT_ID,
        userId: USER_ID,
        errorMessage: expect.stringContaining("BullMQ enqueue failed"),
      }),
    );
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });
});
