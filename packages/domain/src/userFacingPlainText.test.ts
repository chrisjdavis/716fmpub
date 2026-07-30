import { describe, expect, it } from "vitest";
import { sanitizeUserFacingPlainText } from "./userFacingPlainText.js";

describe("sanitizeUserFacingPlainText", () => {
  it("strips NUL and replaces other C0 controls (keeps tab/lf/cr)", () => {
    expect(sanitizeUserFacingPlainText("a\u0000b")).toBe("ab");
    expect(sanitizeUserFacingPlainText("a\u0001b")).toBe("a b");
    expect(sanitizeUserFacingPlainText("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("removes bidi override marks used for spoofing", () => {
    const spoof = `honest\u202Eexe.retlif`;
    expect(sanitizeUserFacingPlainText(spoof)).toBe("honestexe.retlif");
  });

  it("neutralizes representative XSS-style payloads while preserving visible text", () => {
    const xss = `<img src=x onerror=alert(1)>`;
    expect(sanitizeUserFacingPlainText(xss)).toBe(xss);
    const scriptish = `</script><script>alert(1)</script>`;
    expect(sanitizeUserFacingPlainText(scriptish)).toBe(scriptish);
  });

  it("treats null and undefined as empty string", () => {
    expect(sanitizeUserFacingPlainText(null)).toBe("");
    expect(sanitizeUserFacingPlainText(undefined)).toBe("");
  });
});
