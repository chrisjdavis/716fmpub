/** Civil `YYYY-MM-DD` in an IANA zone for the instant {@link nowMs}. */
export function formatYmdInTimeZone(nowMs: number, ianaTimeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

/** Gregorian civil day arithmetic on `YYYY-MM-DD` (noon UTC anchor). */
export function addCalendarDaysYmd(ymd: string, deltaDays: number): string | null {
  const ms = Date.parse(`${ymd}T12:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms + deltaDays * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function calendarYesterdayYmd(nowMs: number, ianaTimeZone: string): string | null {
  const today = formatYmdInTimeZone(nowMs, ianaTimeZone);
  return addCalendarDaysYmd(today, -1);
}

export function weekdayLongInTimeZone(nowMs: number, ianaTimeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    weekday: "long",
  }).format(new Date(nowMs));
}

export function weekdayLongForYmdAtNoonUtc(ymd: string, ianaTimeZone: string): string {
  const [yS, mS, dS] = ymd.split("-");
  const y = Number(yS);
  const m = Number(mS);
  const d = Number(dS);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return "";
  }
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    weekday: "long",
  }).format(new Date(ms));
}

export function monthDayLongInTimeZone(nowMs: number, ianaTimeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    month: "long",
    day: "numeric",
  }).format(new Date(nowMs));
}

export function calendarHourInTimeZone(nowMs: number, ianaTimeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const h = parts.find((p) => p.type === "hour")?.value;
  const n = h !== undefined ? Number(h) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function isFridayInTimeZone(nowMs: number, ianaTimeZone: string): boolean {
  return weekdayLongInTimeZone(nowMs, ianaTimeZone) === "Friday";
}
