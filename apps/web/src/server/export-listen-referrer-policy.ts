/**
 * Export status and artifact responses may surface URLs containing `token=`.
 * Suppress Referer leakage on any follow-on navigations from this response.
 */
export const EXPORT_LISTEN_NO_REFERRER_HEADERS = {
  "Referrer-Policy": "no-referrer",
} as const;
