import { describe, expect, it } from "vitest";

import { redactZodFlattenForPublicApi } from "./zod-public-details.js";

describe("redactZodFlattenForPublicApi", () => {
  it("scrubs messages for password and token field keys", () => {
    const flat = {
      formErrors: [] as string[],
      fieldErrors: {
        password: ["Too short"],
        email: ["Invalid email"],
      },
    };
    const out = redactZodFlattenForPublicApi(flat);
    expect(out.fieldErrors.password).toEqual(["Invalid value"]);
    expect(out.fieldErrors.email).toEqual(["Invalid email"]);
  });

  it("scrubs nested path segments such as body.password", () => {
    const flat = {
      formErrors: [],
      fieldErrors: {
        "body.password": ["Required"],
        "body.displayName": ["Too long"],
      },
    };
    const out = redactZodFlattenForPublicApi(flat);
    expect(out.fieldErrors["body.password"]).toEqual(["Invalid value"]);
    expect(out.fieldErrors["body.displayName"]).toEqual(["Too long"]);
  });

  it("scrubs lastfmApiKey validation messages", () => {
    const flat = {
      formErrors: [],
      fieldErrors: {
        lastfmApiKey: ["String must contain at least 1 character(s)"],
      },
    };
    const out = redactZodFlattenForPublicApi(flat);
    expect(out.fieldErrors.lastfmApiKey).toEqual(["Invalid value"]);
  });
});
