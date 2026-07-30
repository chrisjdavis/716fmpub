import { NextResponse } from "next/server";
import { countUsers, getPool, insertSoleOwnerUser } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { apiCsrfInvalidJson } from "@/server/api/api-csrf-response";
import { authSetupBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { applyCsrfCookie, csrfDoubleSubmitValid, newCsrfToken } from "@/server/auth/csrf-cookie";
import { hashPassword } from "@/server/auth/password";
import {
  applySessionCookie,
  createDbSession,
  invalidatePriorSessionsForAuthTransition,
  readSessionRawToken,
} from "@/server/auth/session";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

/**
 * Bootstraps a CSRF cookie for first-run setup (no session yet).
 * Clients must call this before `POST /api/auth/setup`.
 */
export async function GET(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
    const env = loadServerEnv();
    const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
    if (transportDenied) {
      return transportDenied;
    }
    const res = NextResponse.json({ ok: true });
    applyCsrfCookie(res, newCsrfToken());
    return res;
  });
}

export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
    const env = loadServerEnv();
    const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
    if (transportDenied) {
      return transportDenied;
    }

    const csrfOk = await csrfDoubleSubmitValid(req);
    if (!csrfOk) {
      return apiCsrfInvalidJson();
    }

    const parsed = await parseJsonBodyWithSchema(
      req,
      authSetupBodySchema,
      env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const email = parsed.data.email;
    const pool = getPool(env);

    // Reject already-configured instances before Argon2 work.
    const existingCount = await countUsers(pool);
    if (existingCount > 0) {
      return NextResponse.json(
        { error: "Already set up", code: "already_configured" },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const priorSessionRaw = await readSessionRawToken();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const created = await insertSoleOwnerUser(client, {
        canonicalEmail: email,
        passwordHash,
      });
      if (!created.ok) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Already set up", code: "already_configured" },
          { status: 409 },
        );
      }
      const { userId: id } = created;
      await invalidatePriorSessionsForAuthTransition(client, {
        userId: id,
        requestSessionRawToken: priorSessionRaw,
      });
      const { rawToken } = await createDbSession(client, id);
      await client.query("COMMIT");

      const res = NextResponse.json(
        { user: { id, email } },
        { status: 201 },
      );
      applySessionCookie(res, rawToken);
      applyCsrfCookie(res, newCsrfToken());
      return res;
    } catch (err) {
      await client.query("ROLLBACK");
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "23505"
      ) {
        return NextResponse.json(
          { error: "Already set up", code: "already_configured" },
          { status: 409 },
        );
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
