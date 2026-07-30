import { loadServerEnv } from "@vs/env";
import { signListenRealtimeToken } from "@vs/realtime-token";
import { NextResponse } from "next/server";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

const TOKEN_TTL_SEC = 300 as const;

export type ListenRealtimeHandshakeResponse =
  | { enabled: false }
  | { enabled: true; wsUrl: string; token: string };

/**
 * Issues a short-lived token and public WebSocket URL for dashboard listen push.
 * When realtime is not configured, returns `{ enabled: false }` and the client keeps HTTP polling.
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    if (!env.REALTIME_JWT_SECRET) {
      const body: ListenRealtimeHandshakeResponse = { enabled: false };
      return NextResponse.json(body);
    }

    const wsUrl =
      env.NEXT_PUBLIC_LISTEN_REALTIME_WS_URL?.trim() ||
      env.LISTEN_REALTIME_WS_URL?.trim() ||
      `ws://127.0.0.1:${env.LISTEN_REALTIME_PORT}`;

    const token = signListenRealtimeToken(
      env.REALTIME_JWT_SECRET,
      user.id,
      TOKEN_TTL_SEC,
    );

    const body: ListenRealtimeHandshakeResponse = {
      enabled: true,
      wsUrl,
      token,
    };
    return NextResponse.json(body);
  });
}
