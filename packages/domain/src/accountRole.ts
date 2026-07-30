/** Application account privilege tier (persisted as `users.account_role`). */
export const ACCOUNT_ROLES = ["user", "admin", "owner"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const ACCOUNT_ROLE_ORDER: Record<AccountRole, number> = {
  user: 0,
  admin: 1,
  owner: 2,
};

export function isAccountRole(value: string): value is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least `minimum` in the persisted privilege ordering (`user` < `admin` < `owner`). */
export function accountRoleAtLeast(role: AccountRole, minimum: AccountRole): boolean {
  return ACCOUNT_ROLE_ORDER[role] >= ACCOUNT_ROLE_ORDER[minimum];
}
