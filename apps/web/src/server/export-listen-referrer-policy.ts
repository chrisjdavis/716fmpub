/**
 * Export status and artifact download responses.
 * Delivery tokens are returned in JSON and sent via `Authorization: Bearer`; keep no-referrer
 * as defense in depth for any residual query-token clients.
 */
export const EXPORT_LISTEN_NO_REFERRER_HEADERS = {
  "Referrer-Policy": "no-referrer",
} as const;
