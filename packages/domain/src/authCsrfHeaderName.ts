/**
 * Request header carrying the CSRF token for double-submit validation.
 * Value must match the non-HttpOnly CSRF cookie (`AUTH_CSRF_COOKIE_NAME`).
 */
export const API_CSRF_HEADER_NAME = "x-csrf-token" as const;
