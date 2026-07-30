import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@vs/env";

const welcomeMocks = vi.hoisted(() => ({
  claimWelcomeEmailDispatchSlot: vi.fn(),
  releaseWelcomeEmailDispatchSlot: vi.fn(),
  getWebTransactionalMailer: vi.fn(),
  sendWelcome: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  claimWelcomeEmailDispatchSlot: welcomeMocks.claimWelcomeEmailDispatchSlot,
  releaseWelcomeEmailDispatchSlot: welcomeMocks.releaseWelcomeEmailDispatchSlot,
}));

vi.mock("./transactional-mailer", () => ({
  getWebTransactionalMailer: welcomeMocks.getWebTransactionalMailer,
}));

import { enqueueWelcomeEmailIfConfigured } from "./welcome-email-enqueue";

function flushWelcomeMicrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("enqueueWelcomeEmailIfConfigured", () => {
  const pool = {} as import("pg").Pool;
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const baseEnv = {
    welcomeEmailTrigger: "signup" as const,
    publicAppOrigin: "https://app.test",
  } as Pick<ServerEnv, "welcomeEmailTrigger" | "publicAppOrigin">;

  beforeEach(() => {
    vi.clearAllMocks();
    welcomeMocks.getWebTransactionalMailer.mockReturnValue({
      sendWelcome: welcomeMocks.sendWelcome,
    } as never);
    welcomeMocks.sendWelcome.mockResolvedValue({
      kind: "welcome",
      providerMessageId: "stub",
    });
    welcomeMocks.claimWelcomeEmailDispatchSlot.mockResolvedValue({
      email: "welcome@example.test",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when welcomeEmailTrigger is off", () => {
    enqueueWelcomeEmailIfConfigured({
      env: { ...baseEnv, welcomeEmailTrigger: "off" } as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    expect(welcomeMocks.claimWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
  });

  it("does nothing when the trigger point does not match the configured trigger", () => {
    enqueueWelcomeEmailIfConfigured({
      env: { ...baseEnv, welcomeEmailTrigger: "email_verified" } as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    expect(welcomeMocks.claimWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
  });

  it("logs a structured skip when publicAppOrigin is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    enqueueWelcomeEmailIfConfigured({
      env: { ...baseEnv, publicAppOrigin: undefined } as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    expect(warn).toHaveBeenCalled();
    const line = String(warn.mock.calls[0]?.[0]);
    const payload = JSON.parse(line) as { event?: string; reason?: string };
    expect(payload.event).toBe("welcome_email_skipped");
    expect(payload.reason).toBe("public_app_origin_missing");
    expect(welcomeMocks.claimWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs a structured skip when the transactional mailer is unavailable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    welcomeMocks.getWebTransactionalMailer.mockReturnValue(null);
    enqueueWelcomeEmailIfConfigured({
      env: baseEnv as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    expect(warn).toHaveBeenCalled();
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      event?: string;
      reason?: string;
    };
    expect(payload.event).toBe("welcome_email_skipped");
    expect(payload.reason).toBe("transactional_mailer_unavailable");
    expect(welcomeMocks.claimWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("sends welcome mail with an HTTPS start URL after a successful claim", async () => {
    enqueueWelcomeEmailIfConfigured({
      env: baseEnv as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    await flushWelcomeMicrotask();
    expect(welcomeMocks.claimWelcomeEmailDispatchSlot).toHaveBeenCalledWith(pool, userId);
    expect(welcomeMocks.sendWelcome).toHaveBeenCalledWith({
      to: "welcome@example.test",
      startUrl: "https://app.test/",
    });
    expect(welcomeMocks.releaseWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
  });

  it("does not call sendWelcome when the dispatch slot is already taken", async () => {
    welcomeMocks.claimWelcomeEmailDispatchSlot.mockResolvedValueOnce(null);
    enqueueWelcomeEmailIfConfigured({
      env: baseEnv as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    await flushWelcomeMicrotask();
    expect(welcomeMocks.sendWelcome).not.toHaveBeenCalled();
    expect(welcomeMocks.releaseWelcomeEmailDispatchSlot).not.toHaveBeenCalled();
  });

  it("releases the dispatch slot when sendWelcome rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    welcomeMocks.sendWelcome.mockRejectedValueOnce(new Error("provider transport failed"));
    enqueueWelcomeEmailIfConfigured({
      env: baseEnv as ServerEnv,
      pool,
      userId,
      when: "signup",
    });
    await flushWelcomeMicrotask();
    expect(welcomeMocks.releaseWelcomeEmailDispatchSlot).toHaveBeenCalledWith(pool, userId);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
