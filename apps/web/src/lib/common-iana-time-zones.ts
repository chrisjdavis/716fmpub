const STATS_TZ_OPTGROUP_ORDER = [
  "General",
  "Americas",
  "Europe",
  "Asia",
  "Australia",
  "Pacific",
] as const;

function statsTimeZoneOptgroup(zone: string): (typeof STATS_TZ_OPTGROUP_ORDER)[number] {
  if (zone === "UTC") {
    return "General";
  }
  if (zone.startsWith("America/")) {
    return "Americas";
  }
  if (zone.startsWith("Europe/")) {
    return "Europe";
  }
  if (zone.startsWith("Asia/")) {
    return "Asia";
  }
  if (zone.startsWith("Australia/")) {
    return "Australia";
  }
  if (zone.startsWith("Pacific/")) {
    return "Pacific";
  }
  return "General";
}

/** Curated list for settings; users may also type a valid IANA name in product iterations. */
export const COMMON_STATS_TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
] as const;

/** Stable `<optgroup>` buckets for the stats timezone control (same zones as {@link COMMON_STATS_TIME_ZONES}). */
export function commonStatsTimeZonesGrouped(): { label: string; zones: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const label of STATS_TZ_OPTGROUP_ORDER) {
    buckets.set(label, []);
  }
  for (const z of COMMON_STATS_TIME_ZONES) {
    const g = statsTimeZoneOptgroup(z);
    buckets.get(g)!.push(z);
  }
  return STATS_TZ_OPTGROUP_ORDER.map((label) => ({
    label,
    zones: buckets.get(label)!,
  })).filter((g) => g.zones.length > 0);
}
