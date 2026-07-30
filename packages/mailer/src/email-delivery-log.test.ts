import { describe, expect, it } from "vitest";
import { MailgunTransportError } from "./mailgun-mailer.js";
import { summarizeProviderThrowableForLog } from "./email-delivery-log.js";

describe("summarizeProviderThrowableForLog", () => {
  it("includes http status and hint for MailgunTransportError", () => {
    const err = new MailgunTransportError("rejected", 400, "key=<redacted> bad");
    const s = summarizeProviderThrowableForLog(err);
    expect(s.errorType).toBe("MailgunTransportError");
    expect(s.httpStatus).toBe(400);
    expect(s.responseHint).toContain("bad");
  });

  it("summarizes unknown errors without mailgun fields", () => {
    const s = summarizeProviderThrowableForLog(new Error("plain"));
    expect(s.errorMessage).toContain("plain");
    expect(s.httpStatus).toBeUndefined();
  });
});
