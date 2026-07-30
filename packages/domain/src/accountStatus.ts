/** Account lifecycle gate for authentication (persisted as `users.account_status`). */
export const ACCOUNT_STATUSES = ["active", "disabled", "suspended"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: string): value is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value);
}
