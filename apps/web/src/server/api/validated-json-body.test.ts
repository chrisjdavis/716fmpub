import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AUTH_ACCOUNT_JSON_MAX_BYTES,
  parseJsonBodyWithSchema,
  parseOptionalJsonBodyWithSchema,
  readRequestTextWithByteLimit,
  zodValidationErrorResponse,
} from "./validated-json-body";

const tinySchema = z.object({ a: z.number().int() }).strict();

describe("readRequestTextWithByteLimit", () => {
  it("returns 400 for a non-numeric Content-Length", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-length": "nope" },
      body: "{}",
    });
    const out = await readRequestTextWithByteLimit(req, AUTH_ACCOUNT_JSON_MAX_BYTES);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
      const j = (await out.response.json()) as { error?: string };
      expect(j.error).toMatch(/Content-Length/i);
    }
  });

  it("returns 413 when Content-Length exceeds the cap without buffering the whole body", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-length": String(AUTH_ACCOUNT_JSON_MAX_BYTES + 1) },
      body: "x",
    });
    const out = await readRequestTextWithByteLimit(req, AUTH_ACCOUNT_JSON_MAX_BYTES);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(413);
    }
  });

  it("returns 413 when the body stream exceeds the cap (no Content-Length)", async () => {
    const long = "a".repeat(AUTH_ACCOUNT_JSON_MAX_BYTES + 1);
    const req = new Request("http://localhost/t", {
      method: "POST",
      body: long,
    });
    const out = await readRequestTextWithByteLimit(req, AUTH_ACCOUNT_JSON_MAX_BYTES);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(413);
    }
  });

  it("decodes UTF-8 text under the cap", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":"π"}',
    });
    const out = await readRequestTextWithByteLimit(req, AUTH_ACCOUNT_JSON_MAX_BYTES);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain("π");
    }
  });
});

describe("parseJsonBodyWithSchema", () => {
  it("returns 415 when Content-Type is not application/json", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ a: 1 }),
    });
    const out = await parseJsonBodyWithSchema(req, tinySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(415);
      const j = (await out.response.json()) as { code?: string };
      expect(j.code).toBe("invalid_content_type");
    }
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    const out = await parseJsonBodyWithSchema(req, tinySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
      const j = (await out.response.json()) as { error?: string };
      expect(j.error).toBe("Invalid JSON body");
    }
  });

  it("returns 400 for an empty body", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "   ",
    });
    const out = await parseJsonBodyWithSchema(req, tinySchema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
    }
  });

  it("returns 400 with redacted-safe details for schema violations", async () => {
    const schema = z
      .object({
        password: z.string().min(1),
      })
      .strict();
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });
    const out = await parseJsonBodyWithSchema(req, schema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
      const j = (await out.response.json()) as {
        error?: string;
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      };
      expect(j.error).toBe("Invalid request");
      expect(j.details?.fieldErrors?.password?.[0]).toBe("Invalid value");
    }
  });

  it("returns parsed data on success", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ a: 7 }),
    });
    const out = await parseJsonBodyWithSchema(req, tinySchema);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({ a: 7 });
    }
  });
});

describe("zodValidationErrorResponse", () => {
  it("VS-51: strips NUL and bidi marks from flattened field messages", async () => {
    const schema = z.object({
      title: z.string().refine(() => false, { message: "bad\u0000\u202Emsg" }),
    });
    const parsed = schema.safeParse({ title: "x" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const res = zodValidationErrorResponse(parsed.error);
      expect(res.status).toBe(400);
      const j = (await res.json()) as {
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      };
      expect(j.details?.fieldErrors?.title?.[0]).toBe("badmsg");
    }
  });
});

describe("parseOptionalJsonBodyWithSchema", () => {
  it("accepts an empty body as undefined data", async () => {
    const req = new Request("http://localhost/t", { method: "POST" });
    const out = await parseOptionalJsonBodyWithSchema(
      req,
      z.object({}).strict(),
      1024,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toBeUndefined();
    }
  });

  it("validates a non-empty body", async () => {
    const req = new Request("http://localhost/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const out = await parseOptionalJsonBodyWithSchema(
      req,
      z.object({}).strict(),
      1024,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({});
    }
  });
});
