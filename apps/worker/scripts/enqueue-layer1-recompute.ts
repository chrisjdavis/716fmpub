/**
 * Enqueues `layer1_evidence_recompute` on the analytics BullMQ queue (VS-51).
 *
 * Refuses `deployEnv === "production"`. Requires Redis queues (not `skipRedisQueues`).
 *
 * `--users` routes each id through {@link enqueueLayer1EvidenceRecomputeForUser} with
 * `internalEntitlementOverride` so operator tooling shares the same persistence + queue
 * contract as product code while bypassing the Advanced gate intentionally.
 *
 * `--cursor-batch` remains a direct bounded `user_cursor_batch` publish for admin paging; it
 * does not run per-user entitlement at enqueue time (scope is resolved in the worker).
 *
 * User-scoped (1–200 UUIDs per invocation; one validated job per user):
 *   npm run enqueue:layer1-recompute -- --users <uuid>[,uuid...]
 *
 * Cursor batch (ordered by `users.id`, `limit` 1–500):
 *   npm run enqueue:layer1-recompute -- --cursor-batch --limit 100
 *   npm run enqueue:layer1-recompute -- --cursor-batch --limit 100 --after <uuid>
 *
 * Optional: `--artist-limit <1-50>`, `--correlation-id <string>`.
 */
import { enqueueLayer1EvidenceRecomputeForUser, getPool } from "@vs/db";
import { loadServerEnv, isRedisQueuesEnabled } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  createAnalyticsQueue,
  enqueueLayer1EvidenceRecomputeUserCursorBatch,
  verifyRedisConnectivity,
  VS_QUEUE_NAMES,
} from "@vs/queue";
import { z } from "zod";

const uuidListSchema = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().uuid()).min(1).max(200));

function printUsage(exitCode: number): never {
  console.error(`enqueue-layer1-recompute — enqueue Layer 1 evidence recompute (analytics queue)

Refuses production deploy tier. Requires REDIS_URL and queues enabled (not FEATURE_FLAGS.skipRedisQueues).

  --users <uuid>[,uuid...]     Enqueue one job for explicit user ids (max 200 per invocation).

  --cursor-batch               Enqueue a bounded page of users by id order.
  --limit <n>                  With --cursor-batch: page size (1–500).
  --after <uuid> | start       Cursor: users.id strictly after this UUID; omit or \`start\` for first page.

  --artist-limit <n>          Optional; caps artists per user (1–50, job contract).
  --correlation-id <id>       Optional tracing id for logs.

Examples:
  npm run enqueue:layer1-recompute -- --users 00000000-0000-4000-8000-000000000001
  npm run enqueue:layer1-recompute -- --cursor-batch --limit 50 --after start
`);
  process.exit(exitCode);
}

function takeFlagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) {
    return undefined;
  }
  const v = args[i + 1];
  if (v === undefined || v.startsWith("-")) {
    throw new Error(`missing value for ${flag}`);
  }
  return v;
}

function parseCli(argv: string[]): Readonly<{
  mode:
    | { kind: "explicit_user_ids"; userIds: readonly string[] }
    | {
        kind: "user_cursor_batch";
        cursorAfterUserId: string | null;
        limit: number;
      };
  artistLimit?: number;
  correlationId?: string;
}> {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage(args.length === 0 ? 1 : 0);
  }

  const hasUsers = args.includes("--users");
  const hasCursor = args.includes("--cursor-batch");
  if (hasUsers === hasCursor) {
    console.error(
      "enqueue-layer1-recompute: specify exactly one of --users <list> or --cursor-batch",
    );
    printUsage(1);
  }

  let artistLimit: number | undefined;
  const alRaw = takeFlagValue(args, "--artist-limit");
  if (alRaw !== undefined) {
    const n = Number(alRaw);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      throw new Error("--artist-limit must be an integer from 1 to 50");
    }
    artistLimit = n;
  }

  const correlationId = takeFlagValue(args, "--correlation-id");

  if (hasUsers) {
    const raw = takeFlagValue(args, "--users");
    if (raw === undefined) {
      throw new Error("missing --users value");
    }
    const userIds = uuidListSchema.parse(raw);
    return {
      mode: { kind: "explicit_user_ids", userIds },
      artistLimit,
      correlationId,
    };
  }

  const limitRaw = takeFlagValue(args, "--limit");
  if (limitRaw === undefined) {
    throw new Error("--cursor-batch requires --limit <n>");
  }
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("--limit must be an integer from 1 to 500");
  }

  const afterRaw = takeFlagValue(args, "--after");
  let cursorAfterUserId: string | null;
  if (afterRaw === undefined || afterRaw === "start") {
    cursorAfterUserId = null;
  } else {
    cursorAfterUserId = z.string().uuid().parse(afterRaw);
  }

  return {
    mode: { kind: "user_cursor_batch", cursorAfterUserId, limit },
    artistLimit,
    correlationId,
  };
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (env.deployEnv === "production") {
    console.error(
      "enqueue-layer1-recompute: refusing to run when deploy environment is production",
    );
    process.exit(1);
  }

  if (!isRedisQueuesEnabled(env)) {
    console.error(
      "enqueue-layer1-recompute: Redis queues are disabled (FEATURE_FLAGS.skipRedisQueues). Remove the flag and set REDIS_URL to enqueue.",
    );
    process.exit(1);
  }

  const probe = await verifyRedisConnectivity(env);
  if (!probe.ok) {
    console.error("[enqueue-layer1-recompute] Redis unreachable:", probe.reason);
    process.exit(1);
  }

  const parsed = parseCli(process.argv);

  const queue = createAnalyticsQueue(env);
  try {
    if (parsed.mode.kind === "explicit_user_ids") {
      const pool = getPool(env);
      const summary = {
        enqueued: 0,
        skipped_not_entitled: 0,
        skipped_already_fresh: 0,
        skipped_retry_exhausted: 0,
        skipped_user_not_found: 0,
        skipped_redis_disabled: 0,
        enqueue_redis_failed: 0,
      };
      for (const userId of parsed.mode.userIds) {
        const out = await enqueueLayer1EvidenceRecomputeForUser({
          db: pool,
          queue,
          userId,
          reason: "admin_manual",
          correlationId: parsed.correlationId,
          artistLimit: parsed.artistLimit,
          internalEntitlementOverride: true,
        });
        switch (out.outcome) {
          case "enqueued":
            summary.enqueued += 1;
            break;
          case "skipped_not_entitled":
            summary.skipped_not_entitled += 1;
            break;
          case "skipped_already_fresh":
            summary.skipped_already_fresh += 1;
            break;
          case "skipped_retry_exhausted":
            summary.skipped_retry_exhausted += 1;
            break;
          case "skipped_user_not_found":
            summary.skipped_user_not_found += 1;
            break;
          case "skipped_redis_disabled":
            summary.skipped_redis_disabled += 1;
            break;
          case "enqueue_redis_failed":
            summary.enqueue_redis_failed += 1;
            break;
        }
      }
      console.log(
        `[enqueue-layer1-recompute] layer1_evidence_recompute per-user enqueue via central gate users=${parsed.mode.userIds.length} queue=${VS_QUEUE_NAMES.ANALYTICS} outcomes=${JSON.stringify(summary)}`,
      );
    } else {
      await enqueueLayer1EvidenceRecomputeUserCursorBatch(queue, {
        cursorAfterUserId: parsed.mode.cursorAfterUserId,
        limit: parsed.mode.limit,
        enqueueReason: "internal_backfill",
        artistLimit: parsed.artistLimit,
        correlationId: parsed.correlationId,
      });
      console.log(
        `[enqueue-layer1-recompute] enqueued layer1_evidence_recompute cursor_batch limit=${parsed.mode.limit} after=${parsed.mode.cursorAfterUserId ?? "null"} queue=${VS_QUEUE_NAMES.ANALYTICS}`,
      );
    }
  } finally {
    await queue.close();
  }
}

void main().catch((err: unknown) => {
  if (err instanceof z.ZodError) {
    console.error(
      "enqueue-layer1-recompute: validation error",
      err.flatten().fieldErrors,
    );
    process.exit(1);
  }
  console.error(
    "enqueue-layer1-recompute: fatal",
    summarizeThrowableForLog(err),
  );
  process.exit(1);
});
