/**
 * Baseline browser security headers (CSP and related) for Edge middleware.
 * Policy is explicit per environment: dev relaxes script rules for the Next.js dev server only.
 */

export type NodeEnvForCsp = "development" | "production" | "test";

export type BrowserSecurityHeaderInput = {
  nodeEnv: NodeEnvForCsp;
  /** Non-empty trimmed WebSocket base URLs from env (ws: or wss:). */
  realtimeWsUrlCandidates: readonly string[];
  /**
   * Per-request CSP nonce. When set, production browsers that support CSP2 ignore
   * `'unsafe-inline'` for scripts that lack the matching nonce attribute.
   */
  scriptNonce?: string;
};

/**
 * Parses a URL string into a CSP host-source for connect-src (scheme + host + optional port).
 * Returns null if not http(s) or ws(s).
 */
export function wsOrHttpUrlToConnectSource(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const { protocol, hostname, port } = parsed;
  if (
    protocol !== "http:" &&
    protocol !== "https:" &&
    protocol !== "ws:" &&
    protocol !== "wss:"
  ) {
    return null;
  }
  if (!hostname) {
    return null;
  }
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  const portPart = port ? `:${port}` : "";
  return `${protocol}//${host}${portPart}`;
}

/**
 * Local dev connect sources (CSP Level 3 port wildcard) for Next dev + default realtime WS.
 */
const DEV_LOCAL_CONNECT_EXTRA = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
] as const;

function uniqueConnectSources(sources: string[]): string[] {
  return [...new Set(sources.filter(Boolean))];
}

/**
 * Builds a single CSP value (no report-uri / report-to in this baseline).
 */
export function buildContentSecurityPolicy(input: BrowserSecurityHeaderInput): string {
  const isDev = input.nodeEnv === "development";

  const scriptParts = [
    "'self'",
    // Next App Router emits inline bootstrap/RSC scripts. Prefer a per-request nonce
    // (middleware sets `x-nonce` + this CSP value). Keep `'unsafe-inline'` only as a
    // legacy-browser fallback; CSP2+ ignores it when a nonce is present.
    ...(input.scriptNonce ? [`'nonce-${input.scriptNonce}'`, "'strict-dynamic'"] : []),
    "'unsafe-inline'",
    "https://static.cloudflareinsights.com",
  ];
  if (isDev) {
    scriptParts.push("'unsafe-eval'");
  }
  const scriptSrc = scriptParts.join(" ");
  const styleSrc = "'self' 'unsafe-inline'";
  const imgSrc = "'self' data: blob: https:";
  const fontSrc = "'self' data:";
  const connectParts: string[] = ["'self'", "https://cloudflareinsights.com"];

  if (isDev) {
    connectParts.push(...DEV_LOCAL_CONNECT_EXTRA);
  }

  for (const raw of input.realtimeWsUrlCandidates) {
    const src = wsOrHttpUrlToConnectSource(raw);
    if (src) {
      connectParts.push(src);
    }
  }

  const connectSrc = uniqueConnectSources(connectParts).join(" ");

  const directives: string[] = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectSrc}`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function readRealtimeWsUrlCandidatesFromEnv(
  raw: Record<string, string | undefined>,
): string[] {
  const out: string[] = [];
  const pub = raw.NEXT_PUBLIC_LISTEN_REALTIME_WS_URL?.trim();
  const internal = raw.LISTEN_REALTIME_WS_URL?.trim();
  if (pub) {
    out.push(pub);
  }
  if (internal && internal !== pub) {
    out.push(internal);
  }
  const portRaw = raw.LISTEN_REALTIME_PORT?.trim();
  if (portRaw) {
    const port = Number(portRaw);
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
      out.push(`ws://127.0.0.1:${port}`);
      out.push(`ws://localhost:${port}`);
    }
  }
  return out;
}

export function resolveNodeEnvForCsp(
  nodeEnv: string | undefined,
): "development" | "production" | "test" {
  if (nodeEnv === "development" || nodeEnv === "production" || nodeEnv === "test") {
    return nodeEnv;
  }
  return "production";
}

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";

/**
 * Applies CSP, frame protection, MIME sniffing guard, referrer policy, permissions policy, and COOP.
 */
export function applyBrowserSecurityHeaders(
  headers: Headers,
  input: BrowserSecurityHeaderInput,
): void {
  headers.set("Content-Security-Policy", buildContentSecurityPolicy(input));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
}
