import { describe, expect, it } from "vitest";
import { accountRoleAtLeast, isAccountRole } from "./accountRole.js";

describe("isAccountRole", () => {
  it("accepts known roles", () => {
    expect(isAccountRole("user")).toBe(true);
    expect(isAccountRole("admin")).toBe(true);
    expect(isAccountRole("owner")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isAccountRole("superuser")).toBe(false);
  });
});

describe("accountRoleAtLeast", () => {
  it("orders user < admin < owner", () => {
    expect(accountRoleAtLeast("user", "user")).toBe(true);
    expect(accountRoleAtLeast("user", "admin")).toBe(false);
    expect(accountRoleAtLeast("user", "owner")).toBe(false);

    expect(accountRoleAtLeast("admin", "admin")).toBe(true);
    expect(accountRoleAtLeast("admin", "user")).toBe(true);
    expect(accountRoleAtLeast("admin", "owner")).toBe(false);

    expect(accountRoleAtLeast("owner", "owner")).toBe(true);
    expect(accountRoleAtLeast("owner", "admin")).toBe(true);
    expect(accountRoleAtLeast("owner", "user")).toBe(true);
  });
});
