import { describe, expect, it } from "vitest";
import { readUserFacingErrorFromResponse, userFacingMessageFromErrorJson } from "./read-user-facing-api-error";

describe("userFacingMessageFromErrorJson", () => {
  it("uses server error string when present", () => {
    expect(userFacingMessageFromErrorJson(401, { error: "Invalid email or password" })).toBe(
      "Invalid email or password",
    );
  });

  it("appends zod field messages after generic error", () => {
    expect(
      userFacingMessageFromErrorJson(400, {
        error: "Invalid request",
        details: {
          formErrors: [],
          fieldErrors: { email: ["Invalid email"] },
        },
      }),
    ).toBe("Invalid request Invalid email");
  });

  it("falls back when body is empty", () => {
    expect(userFacingMessageFromErrorJson(503, null)).toBe(
      "The service is temporarily unavailable.",
    );
  });
});

describe("readUserFacingErrorFromResponse", () => {
  it("parses JSON body", async () => {
    const res = new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
    expect(await readUserFacingErrorFromResponse(res)).toBe("Too many requests");
  });

  it("handles non-JSON body", async () => {
    const res = new Response("not json", { status: 502 });
    expect(await readUserFacingErrorFromResponse(res)).toBe(
      "The server had a problem. Try again shortly.",
    );
  });
});
