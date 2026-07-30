import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  inspectCanonicalVsQueues,
  sortedCanonicalVsQueueNames,
  verifyRedisConnectivity,
} from "@vs/queue/operator-inspection";

async function main(): Promise<void> {
  const allowPartial = process.argv.includes("--allow-partial");
  const env = loadServerEnv();
  const probe = await verifyRedisConnectivity(env);
  if (!probe.ok) {
    console.error("[queue-inspect] Redis unreachable:", probe.reason);
    process.exit(1);
  }

  const jobSampleLimit = env.VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT;

  const report = await inspectCanonicalVsQueues(env, {
    jobSampleLimitPerList: jobSampleLimit,
  });

  console.log(
    `[queue-inspect] meta ${JSON.stringify({
      inspectedAtIso: report.inspectedAtIso,
      jobSampleLimitPerList: report.jobSampleLimitPerList,
      note: report.note,
      strictExitOnQueueErrors: !allowPartial,
    })}`,
  );

  for (const queueErr of report.queueErrors) {
    console.error(
      "[queue-inspect] queue_error",
      JSON.stringify({
        queueName: queueErr.queueName,
        message: queueErr.message,
      }),
    );
  }

  for (const snap of report.queues) {
    console.log(
      `[queue-inspect] snapshot ${JSON.stringify({
        queueName: snap.queueName,
        counts: snap.counts,
        listTruncated: snap.listTruncated,
      })}`,
    );
    for (const row of snap.jobs) {
      console.log(`[queue-inspect] job ${JSON.stringify(row)}`);
    }
  }

  const expectedQueues = sortedCanonicalVsQueueNames().length;
  const okQueues = report.queues.length;
  if (okQueues === 0 && report.queueErrors.length > 0) {
    console.error(
      "[queue-inspect] every canonical queue failed inspection — see queue_error lines above",
    );
    process.exit(1);
  }
  if (report.queueErrors.length > 0) {
    console.error(
      `[queue-inspect] partial failure: ${report.queueErrors.length}/${expectedQueues} queues errored; successful snapshots: ${okQueues}`,
    );
    if (!allowPartial) {
      console.error(
        "[queue-inspect] exiting non-zero (pass --allow-partial to exit 0 when some queues succeed)",
      );
      process.exit(1);
    }
  }
}

void main().catch((err: unknown) => {
  console.error("[queue-inspect] fatal", summarizeThrowableForLog(err));
  process.exit(1);
});
