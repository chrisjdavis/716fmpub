/**
 * Canonical HTTPS link for password recovery (`token` is opaque; only the server can validate).
 * Caller must pass the same `publicAppOrigin` the env layer already normalized from `VS_PUBLIC_APP_ORIGIN`.
 */
export function buildPasswordRecoveryAbsoluteUrl(
  publicAppOrigin: string,
  rawToken: string,
): string {
  const url = new URL("/reset-password", publicAppOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}
