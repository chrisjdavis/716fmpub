/**
 * Register every flag key here before toggling it via `FEATURE_FLAGS` in `.env`.
 * Unknown keys in the JSON payload are rejected so typos fail fast at startup.
 *
 * - `skipRedisQueues`: when true, `REDIS_URL` is optional and BullMQ producers/workers
 *   stay offline so the web app and worker can run against Postgres only (local dev).
 * - `signupsDisabled`: unused in 716fmpub (no public signup; owner created via `/setup`).
 *   Kept for flag-schema compatibility with the commercial edition.
 */
export const FEATURE_FLAG_KEYS = ["skipRedisQueues", "signupsDisabled"] as const;

type TupleElement<T> = T extends readonly (infer E)[] ? E : never;

type FlagKeyTupleElement = TupleElement<typeof FEATURE_FLAG_KEYS>;

/** `string` until the first key is added to {@link FEATURE_FLAG_KEYS}, then narrows to those literals. */
export type FeatureFlagKey = [FlagKeyTupleElement] extends [never]
  ? string
  : FlagKeyTupleElement;
