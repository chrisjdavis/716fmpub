import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertAdminAuditEvent,
  listAdminAuditEvents,
  listAdminAuditEventsWithActorEmail,
  tryInsertAdminAuditEvent,
} from "./adminAuditEvents.js";

describe("adminAuditEvents repository", () => {
  const query = vi.fn();
  const pool = { query };

  beforeEach(() => {
    query.mockReset();
  });

  it("insertAdminAuditEvent inserts a row", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "a1" }] });
    const out = await insertAdminAuditEvent(pool, {
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      action: "admin.user.account_role_changed",
      targetType: "user",
      targetId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      payload: { fromRole: "user", toRole: "admin" },
    });
    expect(out).toEqual({ id: "a1" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into admin_audit_events"),
      [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "admin.user.account_role_changed",
        "user",
        "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        JSON.stringify({ fromRole: "user", toRole: "admin" }),
      ],
    );
  });

  it("insertAdminAuditEvent allows null actor and null target id", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "b1" }] });
    await insertAdminAuditEvent(pool, {
      actorUserId: null,
      action: "admin.invite.created",
      targetType: "invite",
      targetId: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into admin_audit_events"),
      [null, "admin.invite.created", "invite", null, "{}"],
    );
  });

  it("tryInsertAdminAuditEvent swallows insert failures and emits structured insert_failed", async () => {
    query.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      tryInsertAdminAuditEvent(pool, {
        actorUserId: null,
        action: "admin.invite.revoked",
        targetType: "invite",
        targetId: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    const line = String(err.mock.calls[0]?.[0]);
    const payload = JSON.parse(line) as { event: string; vs: { kind: string } };
    expect(payload.vs.kind).toBe("admin_audit");
    expect(payload.event).toBe("insert_failed");
    err.mockRestore();
  });

  it("listAdminAuditEvents drops rows that violate the action/target_type contract", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "bad",
          occurred_at: "2026-01-01T00:00:00.000Z",
          actor_user_id: null,
          action: "not.a.real.action",
          target_type: "user",
          target_id: null,
          payload: {},
        },
        {
          id: "e1",
          occurred_at: "2026-01-02T00:00:00.000Z",
          actor_user_id: null,
          action: "admin.user.account_status_changed",
          target_type: "user",
          target_id: "dddddddd-dddd-4ddd-dddd-dddddddddddd",
          payload: { fromStatus: "active", toStatus: "suspended" },
        },
      ],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await listAdminAuditEvents(pool, { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("e1");
    expect(log).toHaveBeenCalled();
    const warnLine = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(warnLine).event).toBe("list_row_invalid_contract");
    log.mockRestore();
  });

  it("listAdminAuditEvents passes optional filters", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listAdminAuditEvents(pool, {
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "invite",
      targetId: "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee",
      limit: 25,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from admin_audit_events"),
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "invite", "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee", 25],
    );
  });

  it("listAdminAuditEventsWithActorEmail joins users and passes the same filter bind order", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listAdminAuditEventsWithActorEmail(pool, {
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetType: "invite",
      targetId: "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee",
      limit: 25,
    });
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toContain("left join users u on u.id = e.actor_user_id");
    expect(params).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "invite",
      "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee",
      25,
    ]);
  });
});
