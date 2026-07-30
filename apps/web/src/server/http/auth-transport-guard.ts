import type { ServerEnv } from "@vs/env";
import { isStrictDeployEnv } from "@vs/env/deploy-env";
import { NextResponse } from "next/server";
import {
  effectiveRequestHost,
  hostHeaderToUrlHost,
  originHeaderMatchesPublicApp,
} from "@/server/http/request-transport";

/**
 * Strict-tier Host / Origin binding for auth-sensitive HTTP handlers.
 * Non-strict deploys skip checks so local development keeps working without a public origin.
 */
export function rejectUnlessTrustedAuthTransport(
  req: Request,
  env: Pick<ServerEnv, "deployEnv" | "publicAppOrigin" | "trustProxyHeaders">,
): Response | null {
  if (!isStrictDeployEnv(env.deployEnv)) {
    return null;
  }
  const canonical = env.publicAppOrigin;
  if (!canonical) {
    return NextResponse.json(
      {
        error: "Server transport is misconfigured",
        code: "transport_misconfigured",
      },
      { status: 503 },
    );
  }

  const wantHost = new URL(canonical).host.toLowerCase();
  const gotRaw = effectiveRequestHost(req.headers, env.trustProxyHeaders);
  if (!gotRaw) {
    return NextResponse.json(
      { error: "Missing Host header", code: "invalid_host" },
      { status: 403 },
    );
  }
  const gotHost = hostHeaderToUrlHost(gotRaw, "https");
  if (gotHost !== wantHost) {
    return NextResponse.json(
      {
        error: "Request host is not allowed for this application",
        code: "invalid_host",
      },
      { status: 403 },
    );
  }

  const origin = originHeaderMatchesPublicApp(req.headers, canonical);
  if (origin === "mismatch") {
    return NextResponse.json(
      {
        error: "Request origin is not allowed for this application",
        code: "invalid_origin",
      },
      { status: 403 },
    );
  }
  return null;
}
