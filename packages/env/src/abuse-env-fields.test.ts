import { describe, expect, it } from "vitest";
import {
  abuseEnvFieldsSchema,
  defaultAbuseEnvFields,
  parseAbuseEnvFields,
} from "./abuse-env-fields.js";

describe("parseAbuseEnvFields", () => {
  it("matches defaultAbuseEnvFields when unset", () => {
    expect(parseAbuseEnvFields({})).toEqual(defaultAbuseEnvFields);
  });

  it("parses explicit overrides", () => {
    const parsed = parseAbuseEnvFields({
      VS_API_JSON_BODY_MAX_AUTH_BYTES: "4096",
      VS_API_RATE_LIMIT_AUTH_MAX: "5",
      VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX: "3",
      VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS: "120000",
    });
    expect(parsed.VS_API_JSON_BODY_MAX_AUTH_BYTES).toBe(4096);
    expect(parsed.VS_API_RATE_LIMIT_AUTH_MAX).toBe(5);
    expect(parsed.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX).toBe(3);
    expect(parsed.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS).toBe(120_000);
  });

  it("rejects out-of-range body cap", () => {
    expect(() =>
      abuseEnvFieldsSchema.parse({
        VS_API_JSON_BODY_MAX_AUTH_BYTES: 500,
      }),
    ).toThrow(/at least 1024/i);
  });
});
