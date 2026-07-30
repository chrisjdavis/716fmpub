/**
 * Shared identity for outbound transactional messages (display + link base).
 * `publicOrigin` must be an absolute HTTPS origin with no trailing slash.
 */
export type TransactionalEmailAppContext = Readonly<{
  appName: string;
  publicOrigin: string;
  /** Shown in footers; optional when the product has no public support inbox. */
  supportMailbox?: string;
}>;
