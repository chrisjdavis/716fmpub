import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureOutboundMailer,
  NoopOutboundMailer,
  clearCapturedOutboundEmails,
  getCapturedOutboundEmails,
} from "./simulated-outbound-mailer.js";

afterEach(() => {
  clearCapturedOutboundEmails();
  vi.restoreAllMocks();
});

describe("CaptureOutboundMailer", () => {
  it("records messages and returns a synthetic provider id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = new CaptureOutboundMailer();
    const result = await mailer.sendEmail({
      to: "u@example.test",
      subject: "Hello",
      text: "Body",
    });
    expect(result.providerMessageId).toMatch(/^capture:/);
    expect(getCapturedOutboundEmails()).toHaveLength(1);
    expect(getCapturedOutboundEmails()[0]?.to).toBe("u@example.test");
    expect(logSpy.mock.calls.some((c) => JSON.stringify(c).includes("outbound_capture"))).toBe(true);
  });
});

describe("NoopOutboundMailer", () => {
  it("succeeds without capture or network", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mailer = new NoopOutboundMailer();
    const result = await mailer.sendEmail({ to: "u@example.test", subject: "s", text: "t" });
    expect(result.providerMessageId).toMatch(/^noop:/);
    expect(getCapturedOutboundEmails()).toHaveLength(0);
    expect(logSpy.mock.calls.some((c) => JSON.stringify(c).includes("outbound_noop"))).toBe(true);
  });
});
