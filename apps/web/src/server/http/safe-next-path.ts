/**
 * Sanitizes a post-login `?next=` path for same-origin relative navigation.
 * Rejects protocol-relative URLs, backslash tricks, encoded separators, and non-path characters.
 */
export function sanitizeNextPath(next: string | undefined): string {
  const fallback = "/dashboard";
  if (!next || typeof next !== "string") {
    return fallback;
  }
  const trimmed = next.trim();
  if (trimmed === "" || trimmed.includes("\0")) {
    return fallback;
  }
  // Reject backslash (browsers may normalize `\` → `/`) and C0 / whitespace in the raw value.
  if (/[\\\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return fallback;
  }
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  // Reject scheme-ish or authority injection (`/@evil`, `/http:`, encoded slash, etc.).
  if (
    trimmed.includes("://") ||
    trimmed.includes("@") ||
    /%2f/i.test(trimmed) ||
    /%5c/i.test(trimmed) ||
    /%00/i.test(trimmed)
  ) {
    return fallback;
  }

  let pathname: string;
  try {
    const resolved = new URL(trimmed, "https://sanitize.invalid");
    if (resolved.origin !== "https://sanitize.invalid") {
      return fallback;
    }
    if (resolved.username || resolved.password) {
      return fallback;
    }
    pathname = resolved.pathname;
  } catch {
    return fallback;
  }

  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    return fallback;
  }

  // Only allow in-app destinations that login redirects already use.
  const allowedPrefixes = [
    "/dashboard",
    "/onboarding",
    "/explore",
    "/archive",
    "/setup",
  ] as const;
  if (!allowedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return fallback;
  }

  const search = (() => {
    try {
      const u = new URL(trimmed, "https://sanitize.invalid");
      return u.search;
    } catch {
      return "";
    }
  })();
  const hash = (() => {
    try {
      const u = new URL(trimmed, "https://sanitize.invalid");
      // Drop hash fragments from redirects (avoid open-redirect-ish UI tricks).
      void u;
      return "";
    } catch {
      return "";
    }
  })();
  void hash;
  return `${pathname}${search}`;
}
