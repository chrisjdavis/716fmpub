import { isValidIanaTimeZone } from "@/server/infer-briefing-time-zone";

function normalizeDisplayTimeZone(timeZone: string | undefined): string {
  const t = timeZone?.trim();
  if (t !== undefined && t.length > 0 && isValidIanaTimeZone(t)) {
    return t;
  }
  return "UTC";
}

function formatPreciseInTimeZone(ms: number, timeZone: string): string {
  const d = new Date(ms);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hms = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${ymd} ${hms} ${tzName}`;
}

const humanFormatters = new Map<string, Intl.DateTimeFormat>();

function humanFormatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
  let f = humanFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
    humanFormatters.set(timeZone, f);
  }
  return f;
}

/**
 * Formats an ISO-like instant from the server for display, second precision, in {@link timeZone}
 * (IANA). Defaults to UTC. Does not imply sub-second accuracy. Unknown shapes are surfaced verbatim
 * for debugging.
 */
export function formatDashboardTimestamp(isoFromServer: string, timeZone: string = "UTC"): string {
  const trimmed = isoFromServer.trim();
  if (trimmed === "") {
    return "[TIMESTAMP MISSING]";
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return `[UNPARSEABLE TIMESTAMP: ${trimmed}]`;
  }
  const z = normalizeDisplayTimeZone(timeZone);
  try {
    return formatPreciseInTimeZone(ms, z);
  } catch {
    return formatPreciseInTimeZone(ms, "UTC");
  }
}

/**
 * Friendly label for list UI (e.g. recent plays). Same edge cases as {@link formatDashboardTimestamp}.
 */
export function formatDashboardTimestampHuman(isoFromServer: string, timeZone: string = "UTC"): string {
  const trimmed = isoFromServer.trim();
  if (trimmed === "") {
    return "[TIMESTAMP MISSING]";
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return `[UNPARSEABLE TIMESTAMP: ${trimmed}]`;
  }
  const z = normalizeDisplayTimeZone(timeZone);
  try {
    return humanFormatterForTimeZone(z).format(new Date(ms));
  } catch {
    return humanFormatterForTimeZone("UTC").format(new Date(ms));
  }
}
