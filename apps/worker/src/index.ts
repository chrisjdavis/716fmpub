import { randomUUID } from "node:crypto";
import { verifyDatabaseConnectivity, getPool, runWithDbPerfContext } from "@vs/db";
import { WORKER_TICK_INTERVAL_MS, PRODUCT_NAME } from "@vs/domain";
import { isRedisQueuesEnabled, loadServerEnv } from "@vs/env";
import { verifyRedisConnectivity } from "@vs/queue";
import { summarizeThrowableForLog } from "@vs/sensitive";

import { registerBullMqWorkers } from "./registerBullMqWorkers.js";
import { runExportArtifactCleanupTick } from "./runExportArtifactCleanupTick.js";
import { runExportStaleRecoveryTick } from "./runExportStaleRecoveryTick.js";
import { runImportTick } from "./runImportTick.js";
import { runLayer1ReconciliationTick } from "./runLayer1ReconciliationTick.js";
import { runListenSyncEnqueueTick } from "./runListenSyncEnqueueTick.js";

const env = loadServerEnv();

console.log(
  `[worker] ${PRODUCT_NAME} worker starting (tick every ${WORKER_TICK_INTERVAL_MS}ms)`,
);

if (isRedisQueuesEnabled(env)) {
  const redisCheck = await verifyRedisConnectivity(env);
  if (!redisCheck.ok) {
    console.error(
      "[worker] Redis connectivity check failed — exiting:",
      redisCheck.reason,
    );
    process.exit(1);
  }
  console.log("[worker] Redis connectivity OK.");
} else {
  console.log(
    "[worker] Redis/BullMQ disabled (FEATURE_FLAGS skipRedisQueues) — worker tick loop only.",
  );
}

const pool = getPool(env);
const bullmq = registerBullMqWorkers(env, pool);
bullmq.logActiveQueues();

const connectivity = await verifyDatabaseConnectivity(env);
const databaseReady = connectivity.ok;
if (!databaseReady) {
  console.error(
    "[worker] Database connectivity check failed — import pipeline cannot run until this is resolved:",
    connectivity.reason,
  );
} else {
  console.log("[worker] Database connectivity OK.");
}

console.log(
  `[worker] Last.fm API key (worker env): ${env.LASTFM_API_KEY ? "configured" : "not set (imports still run when each user saved a key under Settings)"}`,
);

let ticks = 0;
let busy = false;
let isShuttingDown = false;

const tickHandle = setInterval(() => {
  ticks += 1;
  if (isShuttingDown) {
    return;
  }
  if (!databaseReady) {
    console.error(
      `[worker] degraded tick #${ticks} — database unreachable; import pipeline stalled`,
    );
    return;
  }

  if (busy) {
    return;
  }

  busy = true;
  void (async () => {
    try {
      await runWithDbPerfContext(
        {
          source: `worker.scheduled_tick#${ticks}`,
          sourceKind: "job",
          traceId: randomUUID(),
        },
        async () => {
          await runImportTick(pool, env);
          await runExportStaleRecoveryTick(pool, env);
          await runListenSyncEnqueueTick(pool, env);
          await runLayer1ReconciliationTick(pool, env);
          await runExportArtifactCleanupTick(pool, env);
        },
      );
    } catch (err) {
      console.error(
        `[worker] tick #${ticks} failed:`,
        summarizeThrowableForLog(err),
      );
    } finally {
      busy = false;
    }
  })();
}, WORKER_TICK_INTERVAL_MS);

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(
    `[worker] ${signal} received — stopping tick loop and closing BullMQ workers…`,
  );
  clearInterval(tickHandle);
  try {
    await bullmq.closeAll();
  } catch (err) {
    console.error(
      "[worker] error while closing BullMQ workers:",
      summarizeThrowableForLog(err),
    );
  }
  try {
    await pool.end();
  } catch (err) {
    console.error(
      "[worker] error while closing database pool:",
      summarizeThrowableForLog(err),
    );
  }
  console.log("[worker] graceful shutdown complete.");
}

function forwardShutdown(signal: NodeJS.Signals): void {
  void gracefulShutdown(signal).then(
    () => {
      process.exit(0);
    },
    (err) => {
      console.error(
        "[worker] shutdown failed:",
        summarizeThrowableForLog(err),
      );
      process.exit(1);
    },
  );
}

process.once("SIGINT", () => {
  forwardShutdown("SIGINT");
});
process.once("SIGTERM", () => {
  forwardShutdown("SIGTERM");
});
