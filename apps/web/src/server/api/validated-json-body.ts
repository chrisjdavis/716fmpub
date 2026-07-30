import { NextResponse } from "next/server";
import type { infer as Infer, ZodError, ZodTypeAny } from "zod";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { redactZodFlattenForPublicApi, type ZodFlattenForApi } from "@vs/sensitive";

/**
 * Fallback cap when a route omits an explicit byte limit (prefer `loadServerEnv()` caps:
 * `VS_API_JSON_BODY_MAX_*`).
 */
export const DEFAULT_JSON_BODY_MAX_BYTES = 8192;

/** @deprecated Use `DEFAULT_JSON_BODY_MAX_BYTES` or env-driven limits. */
export const AUTH_ACCOUNT_JSON_MAX_BYTES = DEFAULT_JSON_BODY_MAX_BYTES;

function invalidJsonBodyResponse(): Response {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}

function invalidContentLengthResponse(): Response {
  return NextResponse.json({ error: "Invalid Content-Length" }, { status: 400 });
}

function bodyTooLargeResponse(): Response {
  return NextResponse.json({ error: "Request body too large" }, { status: 413 });
}

function invalidContentTypeResponse(): Response {
  return NextResponse.json(
    { error: "Unsupported Media Type", code: "invalid_content_type" },
    { status: 415 },
  );
}

/**
 * Requires `application/json` (optional charset) so cross-site simple
 * `text/plain` POSTs cannot skip CORS preflight while still parsing as JSON.
 */
export function requireJsonContentType(req: Request): Response | null {
  const raw = req.headers.get("content-type");
  if (raw === null || raw.trim() === "") {
    return invalidContentTypeResponse();
  }
  const mediaType = raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return invalidContentTypeResponse();
  }
  return null;
}

function sanitizeZodFlattenForPublicApi(details: ZodFlattenForApi): ZodFlattenForApi {
  const fieldErrors: ZodFlattenForApi["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(details.fieldErrors)) {
    fieldErrors[key] =
      messages === undefined ? undefined : messages.map((m) => sanitizeUserFacingPlainText(m));
  }
  return {
    formErrors: details.formErrors.map((m) => sanitizeUserFacingPlainText(m)),
    fieldErrors,
  };
}

export function zodValidationErrorResponse(error: ZodError): Response {
  const redacted = redactZodFlattenForPublicApi(error.flatten());
  return NextResponse.json(
    {
      error: "Invalid request",
      details: sanitizeZodFlattenForPublicApi(redacted),
    },
    { status: 400 },
  );
}

function parseContentLength(header: string | null): number | null | "invalid" {
  if (header === null || header.trim() === "") {
    return null;
  }
  const n = Number(header.trim());
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return "invalid";
  }
  return n;
}

/**
 * Reads the request body as UTF-8 text with a hard byte ceiling.
 * When `Content-Length` is present and exceeds `maxBytes`, the body is not read.
 */
export async function readRequestTextWithByteLimit(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  const cl = parseContentLength(req.headers.get("content-length"));
  if (cl === "invalid") {
    return { ok: false, response: invalidContentLengthResponse() };
  }
  if (cl !== null && cl > maxBytes) {
    return { ok: false, response: bodyTooLargeResponse() };
  }

  const byteCap = cl !== null ? Math.min(cl, maxBytes) : maxBytes;
  const stream = req.body;
  if (!stream) {
    return { ok: true, text: "" };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }
      total += value.byteLength;
      if (total > byteCap) {
        return { ok: false, response: bodyTooLargeResponse() };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(merged) };
}

export async function parseJsonBodyWithSchema<T extends ZodTypeAny>(
  req: Request,
  schema: T,
  maxBytes: number = DEFAULT_JSON_BODY_MAX_BYTES,
): Promise<{ ok: true; data: Infer<T> } | { ok: false; response: Response }> {
  const contentTypeDenied = requireJsonContentType(req);
  if (contentTypeDenied) {
    return { ok: false, response: contentTypeDenied };
  }
  const read = await readRequestTextWithByteLimit(req, maxBytes);
  if (!read.ok) {
    return read;
  }
  if (read.text.trim() === "") {
    return { ok: false, response: invalidJsonBodyResponse() };
  }

  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    return { ok: false, response: invalidJsonBodyResponse() };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: zodValidationErrorResponse(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * For routes that accept an empty body (e.g. logout). When a non-empty body is sent, it must satisfy `schema`.
 */
export async function parseOptionalJsonBodyWithSchema<T extends ZodTypeAny>(
  req: Request,
  schema: T,
  maxBytes: number = DEFAULT_JSON_BODY_MAX_BYTES,
): Promise<
  { ok: true; data: Infer<T> | undefined } | { ok: false; response: Response }
> {
  const read = await readRequestTextWithByteLimit(req, maxBytes);
  if (!read.ok) {
    return read;
  }
  if (read.text.trim() === "") {
    return { ok: true, data: undefined };
  }

  const contentTypeDenied = requireJsonContentType(req);
  if (contentTypeDenied) {
    return { ok: false, response: contentTypeDenied };
  }

  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    return { ok: false, response: invalidJsonBodyResponse() };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: zodValidationErrorResponse(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
