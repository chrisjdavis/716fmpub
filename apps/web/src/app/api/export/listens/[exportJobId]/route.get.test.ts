import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getExportJobByIdForUser: vi.fn(),
    getPool: vi.fn(() => ({})),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({})),
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

import { getExportJobByIdForUser } from "@vs/db";
import { GET } from "./route";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USERS_EXPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function getRequest(exportJobId: string): Request {
  return new Request(`http://localhost/api/export/listens/${exportJobId}`);
}

describe("GET /api/export/listens/[exportJobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
  });

  it("returns 404 when the export job belongs to another account", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce(null);
    const res = await GET(getRequest(OTHER_USERS_EXPORT_ID), {
      params: Promise.resolve({ exportJobId: OTHER_USERS_EXPORT_ID }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Export job not found" });
    expect(getExportJobByIdForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        exportJobId: OTHER_USERS_EXPORT_ID,
        userId: USER_A,
      }),
    );
  });

  it("returns 400 for a non-uuid export job id", async () => {
    const res = await GET(getRequest("bad"), {
      params: Promise.resolve({ exportJobId: "bad" }),
    });
    expect(res.status).toBe(400);
    expect(getExportJobByIdForUser).not.toHaveBeenCalled();
  });

  it("returns a download href and bearer token when the artifact is available", async () => {
    const exportId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const token = "s".repeat(43);
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce({
      id: exportId,
      userId: USER_A,
      format: "json",
      stage: "completed",
      artifactRelativePath: `${USER_A}/${exportId}.zip`,
      artifactExpiresAt: "2099-01-01T00:00:00.000Z",
      artifactDeliveryToken: token,
      errorMessage: null,
      bullmqJobId: null,
      itemsProcessed: 1,
      itemsTotal: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET(getRequest(exportId), {
      params: Promise.resolve({ exportJobId: exportId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      download: { href: string; token: string } | null;
    };
    expect(body.download?.href).toBe(`/api/export/listens/${exportId}/download`);
    expect(body.download?.token).toBe(token);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
