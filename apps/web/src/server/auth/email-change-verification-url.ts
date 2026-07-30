/**
 * HTTPS link for completing a pending account email change (`token` is opaque; only the server can validate).
 */
export function buildEmailChangeVerificationAbsoluteUrl(
  publicAppOrigin: string,
  rawToken: string,
): string {
  const url = new URL("/verify-email-change", publicAppOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}
