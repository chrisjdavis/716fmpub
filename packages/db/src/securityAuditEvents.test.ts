import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertSecurityAuditEvent,
  listSecurityAuditEvents,
  tryInsertSecurityAuditEvent,
} from "./securityAuditEvents.js";

describe("securityAuditEvents repository", () => {
  const query = vi.fn();
  const pool = { query };

  beforeEach(() => {
    query.mockReset();
  });

  it("insertSecurityAuditEvent inserts a row", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "a1" }] });
    const out = await insertSecurityAuditEvent(pool, {
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      action: "auth.login",
      outcome: "success",
      metadata: { reason: "x" },
    });
    expect(out).toEqual({ id: "a1" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into security_audit_events"),
      [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "auth.login",
        "success",
        JSON.stringify({ reason: "x" }),
      ],
    );
  });

  it("insertSecurityAuditEvent allows null actor", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "b1" }] });
    await insertSecurityAuditEvent(pool, {
      actorUserId: null,
      action: "auth.login",
      outcome: "failure",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into security_audit_events"),
      [null, "auth.login", "failure", "{}"],
    );
  });

  it("tryInsertSecurityAuditEvent swallows insert failures and emits structured insert_failed", async () => {
    query.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      tryInsertSecurityAuditEvent(pool, {
        actorUserId: null,
        action: "auth.login",
        outcome: "failure",
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    const line = String(err.mock.calls[0]?.[0]);
    const payload = JSON.parse(line) as { event: string; vs: { kind: string } };
    expect(payload.vs.kind).toBe("security_audit");
    expect(payload.event).toBe("insert_failed");
    err.mockRestore();
  });

  it("listSecurityAuditEvents drops rows that violate the action/outcome contract", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "bad",
          occurred_at: "2026-01-01T00:00:00.000Z",
          actor_user_id: null,
          action: "not.a.real.action",
          outcome: "failure",
          metadata: {},
        },
        {
          id: "e1",
          occurred_at: "2026-01-02T00:00:00.000Z",
          actor_user_id: null,
          action: "auth.login",
          outcome: "failure",
          metadata: {},
        },
      ],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await listSecurityAuditEvents(pool, { actorUserId: null, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("e1");
    expect(log).toHaveBeenCalled();
    const warnLine = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(warnLine).event).toBe("list_row_invalid_contract");
    log.mockRestore();
  });

  it("listSecurityAuditEvents orders by time", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "e1",
          occurred_at: "2026-01-02T00:00:00.000Z",
          actor_user_id: null,
          action: "auth.login",
          outcome: "failure",
          metadata: {},
        },
      ],
    });
    const rows = await listSecurityAuditEvents(pool, { actorUserId: null, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("auth.login");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from security_audit_events"),
      [null, 10],
    );
  });
});
