/**
 * Next.js instrumentation runs on the Node server runtime for `next dev` and `next start`.
 *
 * After `loadServerEnv()`, we call `ensureBullMqProducerStackReady()` so the Node
 * server proves the BullMQ producer path (smoke `Queue`, `waitUntilReady`, `close`)
 * against `REDIS_URL`, not only raw Redis. Skipped when `FEATURE_FLAGS` sets
 * `skipRedisQueues` for Postgres-only local development.
 *
 * Environment validation is intentionally skipped when `NEXT_PHASE` is
 * `phase-production-build` so `next build` can run in CI without a live database.
 * That string is an internal Next.js signal (observed on Next 15.5.x); if upgrades
 * change behavior, re-verify with a local `next build` and adjust this guard or
 * supply CI `DATABASE_URL` instead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  const { loadServerEnv } = await import("@vs/env");
  const env = loadServerEnv();
  const { ensureBullMqProducerStackReady } = await import("@vs/queue");
  await ensureBullMqProducerStackReady(env);
}
