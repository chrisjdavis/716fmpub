type ZodLikeDetails = {
  formErrors?: unknown;
  fieldErrors?: Record<string, unknown>;
};

function stringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) {
        out.push(t);
      }
    }
  }
  return out;
}

function messagesFromZodLikeDetails(details: ZodLikeDetails): string[] {
  const form = stringListFromUnknown(details.formErrors);
  const fields = details.fieldErrors;
  if (!fields || typeof fields !== "object") {
    return form;
  }
  const perField: string[] = [];
  for (const msgs of Object.values(fields)) {
    perField.push(...stringListFromUnknown(msgs));
  }
  return [...form, ...perField];
}

function fallbackMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request.";
    case 401:
      return "Invalid email or password.";
    case 403:
      return "This request was blocked.";
    case 409:
      return "That could not be completed because of a conflict.";
    case 413:
      return "Request body too large.";
    case 429:
      return "Too many attempts. Try again in a moment.";
    case 503:
      return "The service is temporarily unavailable.";
    default:
      if (status >= 500) {
        return "The server had a problem. Try again shortly.";
      }
      return `Request failed (${status}).`;
  }
}

/** Builds a single line for UI from a parsed JSON error body (public API shape). */
export function userFacingMessageFromErrorJson(status: number, body: unknown): string {
  if (!body || typeof body !== "object") {
    return fallbackMessageForStatus(status);
  }
  const o = body as Record<string, unknown>;
  const err = o.error;
  if (typeof err !== "string" || !err.trim()) {
    return fallbackMessageForStatus(status);
  }
  const trimmed = err.trim();
  const details = o.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const extra = messagesFromZodLikeDetails(details as ZodLikeDetails);
    if (extra.length > 0) {
      return `${trimmed} ${extra.join(" ")}`.trim();
    }
  }
  return trimmed;
}

/**
 * Reads the response body once and returns text safe to show the user (no secrets).
 * Use only on `!res.ok` paths.
 */
export async function readUserFacingErrorFromResponse(res: Response): Promise<string> {
  let body: unknown;
  try {
    const text = await res.text();
    if (!text.trim()) {
      return fallbackMessageForStatus(res.status);
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return fallbackMessageForStatus(res.status);
  }
  return userFacingMessageFromErrorJson(res.status, body);
}
