import { loadServerEnv } from "@vs/env";
import {
  createSmokeTestQueue,
  verifyRedisConnectivity,
  VS_QUEUE_NAMES,
} from "@vs/queue";

const env = loadServerEnv();
const probe = await verifyRedisConnectivity(env);
if (!probe.ok) {
  console.error("[enqueue-smoke-test-job] Redis unreachable:", probe.reason);
  process.exit(1);
}

const queue = createSmokeTestQueue(env);
try {
  const job = await queue.add("ping", { at: new Date().toISOString() });
  console.log(
    `[enqueue-smoke-test-job] enqueued job id=${job.id ?? "?"} queue=${VS_QUEUE_NAMES.SMOKE_TEST}`,
  );
} finally {
  await queue.close();
}
