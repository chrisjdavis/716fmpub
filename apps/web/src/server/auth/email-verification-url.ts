/**
 * Canonical HTTPS link for signup email verification (`token` is opaque; only the server can validate).
 * Caller must pass the same `publicAppOrigin` the env layer already normalized from `VS_PUBLIC_APP_ORIGIN`.
 */
export function buildEmailVerificationAbsoluteUrl(
  publicAppOrigin: string,
  rawToken: string,
): string {
  const url = new URL("/verify-email", publicAppOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}
