import {
  batchInsertRawScrobbles,
  canonicalizePendingRawScrobblesBatch,
  getListenSyncFromUnixBound,
  getUserLastfmApiKey,
  markImportJobCompleted,
  markImportJobFailed,
  markImportJobFailedWhenRunning,
  updateImportJobProgress,
  type ImportJobRecord,
} from "@vs/db";
import {
  LISTEN_SYNC_MAX_PAGES_PER_RUN,
  LISTEN_SYNC_OVERLAP_SEC,
} from "@vs/domain";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import {
  logQueueActivity,
  summarizeFailure,
  type QueueActivityLogEntry,
  type QueueJobTrace,
} from "@vs/queue";
import {
  fetchLastfmRecentTrackPages,
  LastfmProviderApiError,
  LastfmProviderValidationError,
  LastfmUsernameNotFoundError,
  type LastfmImportListenEvent,
} from "@vs/lastfm-provider";

import {
  isTransientLastfmImportError,
  isTransientPgError,
  withRetryBackoff,
} from "./importBackoff.js";
import { createImportLastfmPagePacer } from "./importPagePacing.js";
import { enqueueDashboardAnalyticsAfterImport } from "./enqueueDashboardAnalyticsAfterImport.js";
import { enqueueLayer1AfterLastfmImportCompletion } from "./enqueueLayer1AfterLastfmImportCompletion.js";
import { enqueueLayer1AfterMeaningfulListenIngestion } from "./enqueueLayer1AfterMeaningfulListenIngestion.js";
import { mapImportListenEventToRawRow } from "./mapImportListenEventToRawRow.js";
import { notifyWebAppListeningHistoryReadCacheInvalidationBestEffort } from "./webReadCacheInvalidation.js";

const ERROR_MESSAGE_MAX = 8000;

/** Oldest listen on a Last.fm page (array is newest-first), matching `scrobbles` `nextTo`. */
function oldestListenUtsOnPage(
  page: readonly LastfmImportListenEvent[],
): bigint {
  if (page.length === 0) {
    throw new Error("Last.fm import yielded an empty page (unsupported)");
  }
  return page[page.length - 1].uts;
}

function truncateErrorMessage(message: string): string {
  if (message.length <= ERROR_MESSAGE_MAX) {
    return message;
  }
  return `${message.slice(0, ERROR_MESSAGE_MAX - 32)} [message truncated]`;
}

function formatWorkerImportError(err: unknown): string {
  if (err instanceof LastfmUsernameNotFoundError) {
    return err.message;
  }
  if (err instanceof LastfmProviderApiError) {
    return err.message;
  }
  if (err instanceof LastfmProviderValidationError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function importPipelineLog(
  trace: QueueJobTrace | undefined,
  level: QueueActivityLogEntry["level"],
  event: "pipeline_progress" | "pipeline_warn",
  job: ImportJobRecord,
  extra?: { detail?: QueueActivityLogEntry["detail"]; failure?: QueueActivityLogEntry["failure"] },
): void {
  if (!trace) {
    return;
  }
  logQueueActivity({
    level,
    event,
    queue: trace.queue,
    bullmqJobId: trace.bullmqJobId,
    importJobId: job.id,
    userId: job.user_id,
    ...extra,
  });
}

const MAX_TRANSIENT_IMPORT_ROUNDS = 40;
const CANONICALIZATION_HEARTBEAT_BATCHES = 10;

type CanonicalizationAccumulator = {
  succeeded: number;
  failed: number;
};

/**
 * Last.fm UNIX listen times are whole seconds and fit `Number` for realistic dates;
 * this rejects pathological values instead of coercing silently.
 */
function unixUtsToNumberForLastFm(uts: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (uts > max || uts < min) {
    throw new Error("listen uts outside Number-safe range for Last.fm API client");
  }
  return Number(uts);
}

async function canonicalizeImportBatches(
  pool: Pool,
  env: ServerEnv,
  job: ImportJobRecord,
  trace: QueueJobTrace | undefined,
  acc: CanonicalizationAccumulator,
  maxBatches: number | "drain",
  itemsProcessedHeartbeat: number,
): Promise<void> {
  let batches = 0;
  for (;;) {
    if (maxBatches !== "drain" && batches >= maxBatches) {
      return;
    }
    const batch = await withRetryBackoff(
      () =>
        canonicalizePendingRawScrobblesBatch(pool, {
          importJobId: job.id,
          userId: job.user_id,
          limit: env.IMPORT_CANONICALIZATION_BATCH_SIZE,
        }),
      { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
    );
    if (batch.examined === 0) {
      return;
    }
    batches += 1;
    acc.succeeded += batch.succeeded;
    acc.failed += batch.failed;
    if (batches % CANONICALIZATION_HEARTBEAT_BATCHES === 0) {
      const heartbeat = await withRetryBackoff(
        () =>
          updateImportJobProgress(pool, {
            jobId: job.id,
            userId: job.user_id,
            itemsProcessed: itemsProcessedHeartbeat,
          }),
        { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
      );
      if (!heartbeat) {
        throw new Error(
          "import job lost running state during canonicalization (heartbeat update rejected)",
        );
      }
    }
    importPipelineLog(trace, "info", "pipeline_progress", job, {
      detail: {
        milestone: "canonicalization_batch",
        raw_rows_examined: batch.examined,
        raw_rows_succeeded: batch.succeeded,
        raw_rows_failed: batch.failed,
        canonicalization_batches_this_phase: batches,
        canonicalization_batch_size: env.IMPORT_CANONICALIZATION_BATCH_SIZE,
      },
    });
  }
}

/**
 * Runs a claimed Last.fm import job.
 *
 * **Retries:** Transient provider failures tear down the `scrobbles` async iterator;
 * we rebuild it after exponential backoff, passing `toUnix` from `checkpoint_oldest_uts`
 * so pagination continues without skipping. Transient DB errors retry around batch
 * insert and checkpoint writes.
 *
 * **Checkpoints:** After each persisted page we update `items_processed`,
 * `checkpoint_pages_completed`, and `checkpoint_oldest_uts`. `items_total` stays unset
 * so clients do not treat it as an authoritative catalogue total.
 *
 * **Restarts:** `runImportTick` re-queues stale `running` rows (see
 * `requeueStaleRunningImportJobs`); those runs restart from the newest page with
 * dedupe on `(user_id, source_event_hash)`.
 *
 * **Canonicalization:** Pending `raw_scrobbles` are canonicalized in bounded batches
 * during fetch and drained after the provider stream finishes. Row-level failures stay
 * on `raw_scrobbles`; a job only fails from canonicalization when no usable listens
 * were produced. Partial success completes with a warning so dashboard/onboarding
 * state follows the imported listening history instead of the failed tail row.
 *
 * **Background sync:** Jobs with `source = 'system_sync'` fetch only listens after a
 * computed `fromUnix` (with overlap), stop after a page of all-duplicate inserts or a
 * page cap, then canonicalize like user imports.
 */
export async function runQueuedLastfmImport(
  pool: Pool,
  env: ServerEnv,
  job: ImportJobRecord,
  trace?: QueueJobTrace,
): Promise<void> {
  const username = job.lastfm_username.trim();

  if (username === "") {
    const msg = "import job has empty lastfm_username (data contract violation)";
    await markImportJobFailed(pool, {
      jobId: job.id,
      userId: job.user_id,
      errorMessage: msg,
    });
    importPipelineLog(trace, "error", "pipeline_progress", job, {
      failure: summarizeFailure(new Error(msg)),
    });
    return;
  }

  const userApiKey = await getUserLastfmApiKey(pool, job.user_id);
  const apiKey = userApiKey ?? env.LASTFM_API_KEY;
  if (!apiKey) {
    const msg =
      "No Last.fm API key available for this account. Add your key under Settings, or configure LASTFM_API_KEY on the worker.";
    await markImportJobFailed(pool, {
      jobId: job.id,
      userId: job.user_id,
      errorMessage: msg,
    });
    importPipelineLog(trace, "error", "pipeline_progress", job, {
      failure: summarizeFailure(new Error(msg)),
    });
    return;
  }

  const isSystemSync = job.source === "system_sync";
  let baseFromUnix: number | undefined;
  if (isSystemSync) {
    const fromBound = await getListenSyncFromUnixBound(pool, {
      userId: job.user_id,
      overlapSec: LISTEN_SYNC_OVERLAP_SEC,
    });
    if (fromBound === null) {
      const completed = await withRetryBackoff(
        () =>
          markImportJobCompleted(pool, {
            jobId: job.id,
            userId: job.user_id,
          }),
        { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
      );
      if (completed) {
        importPipelineLog(trace, "info", "pipeline_progress", job, {
          detail: {
            milestone: "system_sync_no_listens",
            items_processed: completed.items_processed,
          },
        });
        await enqueueDashboardAnalyticsAfterImport(env, job.user_id, {
          listenPeriodMetricsMode: "full",
        });
        await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
      } else {
        importPipelineLog(trace, "error", "pipeline_progress", job, {
          failure: summarizeFailure(
            new Error("system_sync could not mark completed after empty listen set"),
          ),
        });
      }
      return;
    }
    baseFromUnix = fromBound;
  }

  let processed = job.items_processed;
  let pagesDone = job.checkpoint_pages_completed;
  let resumeToUnix: number | undefined =
    pagesDone > 0 && job.checkpoint_oldest_uts !== null
      ? unixUtsToNumberForLastFm(job.checkpoint_oldest_uts)
      : undefined;

  const pagePacer = createImportLastfmPagePacer(
    {
      minIntervalMs: env.IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS,
      burstPages: env.IMPORT_LASTFM_PAGE_BURST,
    },
    undefined,
    ({ waitedMs, pagesCompleted }) => {
      importPipelineLog(trace, "info", "pipeline_progress", job, {
        detail: {
          milestone: "import_lastfm_pacing",
          waited_ms: waitedMs,
          pages_completed_before_fetch: pagesCompleted,
          burst_pages: env.IMPORT_LASTFM_PAGE_BURST,
        },
      });
    },
    pagesDone,
  );

  try {
    let transientRound = 0;
    let streamCompleted = false;
    const canonicalization: CanonicalizationAccumulator = {
      succeeded: 0,
      failed: 0,
    };

    while (!streamCompleted && transientRound < MAX_TRANSIENT_IMPORT_ROUNDS) {
      transientRound += 1;
      try {
        for await (const page of fetchLastfmRecentTrackPages({
          apiKey,
          username,
          limitPerPage: 200,
          fromUnix: isSystemSync ? baseFromUnix : undefined,
          toUnix: resumeToUnix,
          maxRetries: 8,
        })) {
          await pagePacer.beforeNextPage();
          if (page.length === 0) {
            if (isSystemSync) {
              break;
            }
            throw new Error("Last.fm import yielded an empty page (unsupported)");
          }
          const rows = page.map(mapImportListenEventToRawRow);
          const insertResult = await withRetryBackoff(
            () =>
              batchInsertRawScrobbles(pool, {
                importJobId: job.id,
                userId: job.user_id,
                rows,
              }),
            { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
          );
          processed += page.length;
          pagesDone += 1;
          const oldest = oldestListenUtsOnPage(page);
          resumeToUnix = unixUtsToNumberForLastFm(oldest);

          const prog = await withRetryBackoff(
            () =>
              updateImportJobProgress(pool, {
                jobId: job.id,
                userId: job.user_id,
                itemsProcessed: processed,
                checkpointPagesCompleted: pagesDone,
                checkpointOldestUts: oldest,
              }),
            { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
          );
          if (!prog) {
            const msg =
              "import job lost running state during execution (progress update rejected)";
            await markImportJobFailed(pool, {
              jobId: job.id,
              userId: job.user_id,
              errorMessage: msg,
            });
            importPipelineLog(trace, "error", "pipeline_progress", job, {
              failure: summarizeFailure(new Error(msg)),
            });
            await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
            return;
          }
          pagePacer.afterPageCompleted();
          importPipelineLog(trace, "info", "pipeline_progress", job, {
            detail: {
              milestone: "page_persisted",
              items_processed: prog.items_processed,
              checkpoint_pages: prog.checkpoint_pages_completed,
              checkpoint_oldest_uts:
                prog.checkpoint_oldest_uts === null
                  ? null
                  : prog.checkpoint_oldest_uts.toString(),
              page_size: page.length,
              batch_inserted: insertResult.inserted,
              batch_skipped_duplicates: insertResult.skippedDuplicates,
            },
          });
          if (env.IMPORT_CANONICALIZATION_BATCHES_PER_PAGE > 0) {
            await canonicalizeImportBatches(
              pool,
              env,
              job,
              trace,
              canonicalization,
              env.IMPORT_CANONICALIZATION_BATCHES_PER_PAGE,
              processed,
            );
          }
          if (isSystemSync) {
            if (insertResult.inserted === 0 && page.length > 0) {
              break;
            }
            if (pagesDone >= LISTEN_SYNC_MAX_PAGES_PER_RUN) {
              break;
            }
          }
        }
        streamCompleted = true;
      } catch (err) {
        if (
          isTransientLastfmImportError(err) &&
          transientRound < MAX_TRANSIENT_IMPORT_ROUNDS
        ) {
          const delay = Math.min(200 * 2 ** (transientRound - 1), 30_000);
          importPipelineLog(trace, "warn", "pipeline_warn", job, {
            detail: {
              reason: "transient_provider_retry",
              transient_round: transientRound,
              max_transient_rounds: MAX_TRANSIENT_IMPORT_ROUNDS,
              retry_delay_ms: delay,
            },
            failure: summarizeFailure(err),
          });
          await new Promise<void>((r) => {
            setTimeout(r, delay);
          });
          continue;
        }
        throw err;
      }
    }

    if (!streamCompleted) {
      const msg = `Last.fm import aborted: exceeded ${MAX_TRANSIENT_IMPORT_ROUNDS} transient failure recovery rounds`;
      await markImportJobFailed(pool, {
        jobId: job.id,
        userId: job.user_id,
        errorMessage: msg,
      });
      importPipelineLog(trace, "error", "pipeline_progress", job, {
        failure: summarizeFailure(new Error(msg)),
      });
      await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
      return;
    }

    await canonicalizeImportBatches(
      pool,
      env,
      job,
      trace,
      canonicalization,
      "drain",
      processed,
    );
    importPipelineLog(trace, "info", "pipeline_progress", job, {
      detail: {
        milestone: "canonicalization_summary",
        raw_rows_succeeded: canonicalization.succeeded,
        raw_rows_failed: canonicalization.failed,
      },
    });

    const canonicalizationWarning =
      canonicalization.failed > 0
        ? truncateErrorMessage(
            `Canonicalization finished with ${canonicalization.failed} failed raw_scrobble(s) and ${canonicalization.succeeded} succeeded for this job. Imported listens remain usable; inspect raw_scrobbles.canonicalization_status and canonicalization_error where import_job_id matches this job.`,
          )
        : null;
    if (canonicalization.failed > 0 && canonicalization.succeeded === 0) {
      const msg = truncateErrorMessage(
        `Canonicalization finished with ${canonicalization.failed} failed raw_scrobble(s) and no succeeded rows for this job. Inspect raw_scrobbles.canonicalization_status and canonicalization_error where import_job_id matches this job.`,
      );
      await markImportJobFailed(pool, {
        jobId: job.id,
        userId: job.user_id,
        errorMessage: msg,
      });
      importPipelineLog(trace, "error", "pipeline_progress", job, {
        failure: summarizeFailure(new Error(msg)),
      });
      await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
      return;
    }

    const completed = await withRetryBackoff(
      () =>
        markImportJobCompleted(pool, {
          jobId: job.id,
          userId: job.user_id,
          warningMessage: canonicalizationWarning,
        }),
      { isRetryable: isTransientPgError, baseMs: 200, maxAttempts: 6 },
    );
    if (!completed) {
      const msg =
        "markImportJobCompleted rejected (job was not in running state as expected)";
      importPipelineLog(trace, "error", "pipeline_progress", job, {
        failure: summarizeFailure(new Error(msg)),
      });
      const failed = await markImportJobFailed(pool, {
        jobId: job.id,
        userId: job.user_id,
        errorMessage: msg,
      });
      if (!failed) {
        const forced = await markImportJobFailedWhenRunning(pool, {
          jobId: job.id,
          userId: job.user_id,
          errorMessage: msg,
        });
        if (!forced) {
          importPipelineLog(trace, "error", "pipeline_progress", job, {
            failure: summarizeFailure(
              new Error("could not persist failure after completion rejection"),
            ),
            detail: { severity: "critical" },
          });
        }
      }
      await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
      return;
    }

    importPipelineLog(trace, "info", "pipeline_progress", job, {
      detail: {
        milestone: "import_completed",
        items_processed: completed.items_processed,
      },
    });
    await enqueueDashboardAnalyticsAfterImport(env, job.user_id, {
      listenPeriodMetricsMode: "full",
    });
    if (!isSystemSync) {
      await enqueueLayer1AfterLastfmImportCompletion(pool, env, job.user_id);
    } else if (canonicalization.succeeded > 0) {
      await enqueueLayer1AfterMeaningfulListenIngestion(pool, env, job.user_id, {
        canonicalizedNewListenRows: canonicalization.succeeded,
      });
    }
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
  } catch (err) {
    const message = truncateErrorMessage(formatWorkerImportError(err));
    await markImportJobFailed(pool, {
      jobId: job.id,
      userId: job.user_id,
      errorMessage: message,
    });
    importPipelineLog(trace, "error", "pipeline_progress", job, {
      failure: summarizeFailure(err),
    });
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, job.user_id);
  }
}
