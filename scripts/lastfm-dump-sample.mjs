#!/usr/bin/env node
/**
 * Prints one Last.fm `user.getrecenttracks` JSON page (same shape as the worker / `scrobbles`).
 *
 * Run from repo root:
 *   npm run lastfm:dump -- <LASTFM_USERNAME> [limit_up_to_200]
 *
 * Uses `@vs/env` `parseServerEnv` so `LASTFM_API_KEY` is validated with the same contract as services.
 *
 * Already-imported rows also store the per-track object in Postgres:
 *   select raw_payload from raw_scrobbles order by id desc limit 1;
 */

const user = process.argv[2]?.trim();

const { parseServerEnv } = await import("@vs/env");

let env;
try {
  env = parseServerEnv(process.env);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
}

const apiKey = env.LASTFM_API_KEY?.trim();

if (!apiKey || !user) {
  console.error(
    "Usage: npm run lastfm:dump -- <LASTFM_USERNAME>\n" +
      "Requires LASTFM_API_KEY and a valid application environment (DATABASE_URL, REDIS unless skipRedisQueues, etc.); use root `.env` via npm script.",
  );
  process.exit(1);
}

const params = new URLSearchParams({
  method: "user.getrecenttracks",
  format: "json",
  api_key: apiKey,
  user,
  limit: String(Math.min(Number(process.argv[3]) || 5, 200)),
  extended: "1",
});

const url = `https://ws.audioscrobbler.com/2.0/?${params.toString()}`;
const safeUrl = url.replace(apiKey, "***");
console.error("Request:", safeUrl);

const res = await fetch(url, {
  headers: { "User-Agent": "716FM-scripts/lastfm-dump-sample" },
});
const text = await res.text();
console.error("HTTP", res.status, res.statusText);

let body;
try {
  body = JSON.parse(text);
} catch {
  console.log(text.slice(0, 8000));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
