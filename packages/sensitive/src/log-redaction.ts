import { isStrictDeployEnv, resolveDeployEnv } from "@vs/env";

const MESSAGE_CAP = 800;

const SENSITIVE_KEY = new RegExp(
  [
    "^password$",
    "^passwd$",
    "^pass$",
    "^token$",
    "^access_?token$",
    "^refresh_?token$",
    "^id_?token$",
    "^secret$",
    "^client_?secret$",
    "^api_?key$",
    "^apikey$",
    "^authorization$",
    "^cookie$",
    "^set-?cookie$",
    "^session$",
    "^session_?token$",
    "^raw_?token$",
    "^jwt$",
    "^bearer$",
    "^credential(s)?$",
    "^lastfm_?api_?key$",
    "^lastfmApiKey$",
    "^realtime_?jwt_?secret$",
  ].join("|"),
  "i",
);

/** True when this Node process is running with `NODE_ENV=production` (Next.js, worker, etc.). */
export function isNodeProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Logs only in non-strict deploy environments (`development` and `test`).
 * Staging and production (`VS_DEPLOY_ENV` / inferred deploy) stay quiet regardless of `NODE_ENV` alone.
 */
export function devVerboseInfo(...args: unknown[]): void {
  const deploy = resolveDeployEnv({
    NODE_ENV: process.env.NODE_ENV ?? "development",
    VS_DEPLOY_ENV: process.env.VS_DEPLOY_ENV as
      | "development"
      | "staging"
      | "production"
      | "test"
      | undefined,
  });
  if (isStrictDeployEnv(deploy)) {
    return;
  }
  console.debug("[vs:dev-verbose]", ...args);
}

export function redactUrlsAndCredentialsInText(input: string): string {
  let s = input;
  s = s.replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgres://[REDACTED]");
  s = s.replace(/\bredis(?:s)?:\/\/[^\s"'<>]+/gi, "redis://[REDACTED]");
  s = s.replace(/\bmysql:\/\/[^\s"'<>]+/gi, "mysql://[REDACTED]");
  s = s.replace(/\bmongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "mongodb://[REDACTED]");
  s = s.replace(/\bhttps?:\/\/[^/\s:]+:[^@\s/]+@[^\s"'<>]+/gi, "https://[REDACTED]");
  s = s.replace(/\bwss?:\/\/[^/\s:]+:[^@\s/]+@[^\s"'<>]+/gi, "wss://[REDACTED]");
  s = s.replace(/\bAuthorization:\s*[^\n]*/gi, "Authorization: [REDACTED]");
  s = s.replace(/\bCookie:\s*[^\n]*/gi, "Cookie: [REDACTED]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]");
  s = s.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    "[REDACTED_JWT]",
  );
  return s;
}

export function redactForLogLine(input: string): string {
  return redactUrlsAndCredentialsInText(input);
}

function truncateMessage(message: string, max: number): string {
  if (message.length <= max) {
    return message;
  }
  return `${message.slice(0, max - 24)}…[truncated]`;
}

export function isSensitiveKeyName(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Deep-walks JSON-like structures for logging previews. Redacts known sensitive keys and
 * runs string redaction on all string leaves (URLs, cookies, bearer tokens, JWT-shaped blobs).
 */
export function redactUnknownStructured(
  value: unknown,
  maxDepth = 8,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (maxDepth <= 0) {
    return "[max-depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactForLogLine(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return redactForLogLine(String(value));
  }
  if (typeof value !== "object") {
    return "[opaque]";
  }
  if (seen.has(value as object)) {
    return "[circular]";
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => redactUnknownStructured(v, maxDepth - 1, seen));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (isSensitiveKeyName(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactUnknownStructured(v, maxDepth - 1, seen);
    }
  }
  return out;
}

/** Safe, stack-free summary for structured logs and API-adjacent diagnostics. */
export function summarizeThrowableForLog(err: unknown): {
  errorType: string;
  message: string;
} {
  if (err instanceof Error) {
    return {
      errorType: err.name,
      message: redactForLogLine(truncateMessage(err.message, MESSAGE_CAP)),
    };
  }
  return {
    errorType: "non_error_throwable",
    message: redactForLogLine(truncateMessage(String(err), MESSAGE_CAP)),
  };
}
