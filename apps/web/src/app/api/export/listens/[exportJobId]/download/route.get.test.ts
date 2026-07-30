import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoistedFs = vi.hoisted(() => ({
  stat: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: hoistedFs.stat,
}));

vi.mock("node:fs", () => ({
  createReadStream: hoistedFs.createReadStream,
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    computeListenExportArtifactAccess: vi.fn(),
    getExportJobByIdForUser: vi.fn(),
    getPool: vi.fn(() => ({})),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ EXPORT_ARTIFACTS_DIR: "/tmp/vs-artifacts" })),
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

import { computeListenExportArtifactAccess, getExportJobByIdForUser } from "@vs/db";
import { GET } from "./route";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USERS_EXPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWN_EXPORT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELIVERY_TOKEN = "t".repeat(43);

function baseCompletedRow() {
  return {
    id: OWN_EXPORT_ID,
    userId: USER_A,
    format: "json" as const,
    stage: "completed" as const,
    artifactRelativePath: `${USER_A}/${OWN_EXPORT_ID}.zip`,
    artifactExpiresAt: "2099-01-01T00:00:00.000Z",
    artifactDeliveryToken: DELIVERY_TOKEN,
    errorMessage: null,
    bullmqJobId: null,
    itemsProcessed: 1,
    itemsTotal: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function getRequest(exportJobId: string, token?: string): Request {
  const u = new URL(`http://localhost/api/export/listens/${exportJobId}/download`);
  if (token !== undefined) {
    u.searchParams.set("token", token);
  }
  return new Request(u.toString());
}

describe("GET /api/export/listens/[exportJobId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(computeListenExportArtifactAccess).mockReset();
    vi.mocked(computeListenExportArtifactAccess).mockReturnValue("available");
    hoistedFs.stat.mockResolvedValue({ isFile: () => true });
    hoistedFs.createReadStream.mockReturnValue(Readable.from([Buffer.from("PK\x03\x04")]) as never);
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
    const res = await GET(getRequest(OTHER_USERS_EXPORT_ID, DELIVERY_TOKEN), {
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
    expect(computeListenExportArtifactAccess).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid export job id", async () => {
    const res = await GET(getRequest("bad", DELIVERY_TOKEN), {
      params: Promise.resolve({ exportJobId: "bad" }),
    });
    expect(res.status).toBe(400);
    expect(getExportJobByIdForUser).not.toHaveBeenCalled();
  });

  it("returns 410 when the listen-export artifact is expired", async () => {
    vi.mocked(computeListenExportArtifactAccess).mockReturnValue("expired");
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce({
      ...baseCompletedRow(),
      stage: "expired",
      artifactRelativePath: null,
      artifactExpiresAt: "2020-01-01T00:00:00.000Z",
      artifactDeliveryToken: null,
      itemsTotal: null,
    });
    const res = await GET(getRequest(OWN_EXPORT_ID, DELIVERY_TOKEN), {
      params: Promise.resolve({ exportJobId: OWN_EXPORT_ID }),
    });
    expect(res.status).toBe(410);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_expired");
  });

  it("returns 400 when the download token query parameter is missing", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce(baseCompletedRow());
    const res = await GET(getRequest(OWN_EXPORT_ID), {
      params: Promise.resolve({ exportJobId: OWN_EXPORT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_download_token_required");
  });

  it("returns 403 when the download token is forged or belongs to another grant (wrong secret)", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce(baseCompletedRow());
    const wrong = "w".repeat(43);
    const res = await GET(getRequest(OWN_EXPORT_ID, wrong), {
      params: Promise.resolve({ exportJobId: OWN_EXPORT_ID }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_download_token_rejected");
  });

  it("returns 409 when a bookmarked download is reused after the server cleared the delivery token", async () => {
    vi.mocked(computeListenExportArtifactAccess).mockReturnValueOnce("none");
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce({
      ...baseCompletedRow(),
      artifactDeliveryToken: null,
    });
    const res = await GET(getRequest(OWN_EXPORT_ID, DELIVERY_TOKEN), {
      params: Promise.resolve({ exportJobId: OWN_EXPORT_ID }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { code?: string }).toEqual(
      expect.objectContaining({ code: "export_not_ready" }),
    );
  });

  it("streams the ZIP when the session, job, expiry, and token all match", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce(baseCompletedRow());
    const res = await GET(getRequest(OWN_EXPORT_ID, DELIVERY_TOKEN), {
      params: Promise.resolve({ exportJobId: OWN_EXPORT_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(computeListenExportArtifactAccess).toHaveBeenCalled();
    expect(hoistedFs.stat).toHaveBeenCalled();
    expect(hoistedFs.createReadStream).toHaveBeenCalled();
  });
});
