import { z } from "zod";

/**
 * Queues covered by strict payload contracts (`VS_QUEUE_NAMES.IMPORTS` … `INCREMENTAL_SYNC`).
 * Smoke-test wiring stays outside this surface.
 */
export type VsContractQueueKey =
  | "imports"
  | "exports"
  | "analytics"
  | "sync"
  | "incremental_sync";

/**
 * Thrown when a producer or consumer sees a job name or payload that does not
 * match the published contract. Surfaces validation failures for operators
 * instead of silently coercing or guessing.
 */
export class VsInvalidJobPayloadError extends Error {
  constructor(
    public readonly queue: VsContractQueueKey,
    message: string,
    public readonly zodError?: z.ZodError,
  ) {
    super(`[vs-queue:${queue}] ${message}`);
    this.name = "VsInvalidJobPayloadError";
  }
}

// ---------------------------------------------------------------------------
// `imports` queue — ingestion keyed to durable import rows / users.
// ---------------------------------------------------------------------------

/** Allowed BullMQ job `name` values on the `imports` queue. */
export const IMPORTS_QUEUE_JOB_NAME = {
  /**
   * Run a Last.fm pull for one claimed `import_jobs` row. Worker must load
   * credentials and checkpoints from the database; this payload only binds
   * identity so jobs are not ambiguous across accounts.
   */
  LASTFM_ROWS_IMPORT: "lastfm_rows_import",
} as const;

export type ImportsQueueJobName =
  (typeof IMPORTS_QUEUE_JOB_NAME)[keyof typeof IMPORTS_QUEUE_JOB_NAME];

export const lastfmRowsImportPayloadSchema = z.object({
  importJobId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type LastfmRowsImportPayload = z.infer<typeof lastfmRowsImportPayloadSchema>;

export type ImportsJobSpec = {
  name: typeof IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT;
  data: LastfmRowsImportPayload;
};

export function validateImportsJobSpec(spec: ImportsJobSpec): {
  name: ImportsQueueJobName;
  data: LastfmRowsImportPayload;
} {
  if (spec.name !== IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT) {
    throw new VsInvalidJobPayloadError(
      "imports",
      `unsupported job name: ${String(spec.name)}`,
    );
  }
  const parsed = lastfmRowsImportPayloadSchema.safeParse(spec.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("imports", parsed.error.message, parsed.error);
  }
  return { name: spec.name, data: parsed.data };
}

export function parseImportsWorkerJob(job: {
  name: string;
  data: unknown;
}): ImportsJobSpec {
  if (job.name !== IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT) {
    throw new VsInvalidJobPayloadError(
      "imports",
      `unknown job name on worker: ${String(job.name)}`,
    );
  }
  const parsed = lastfmRowsImportPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("imports", parsed.error.message, parsed.error);
  }
  return {
    name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
    data: parsed.data,
  };
}

// ---------------------------------------------------------------------------
// `exports` queue — user- or operator-requested artifact generation.
// ---------------------------------------------------------------------------

export const EXPORTS_QUEUE_JOB_NAME = {
  /** Produce a downloadable package for one export request row. */
  USER_DATA_PACKAGE: "user_data_package",
} as const;

export type ExportsQueueJobName =
  (typeof EXPORTS_QUEUE_JOB_NAME)[keyof typeof EXPORTS_QUEUE_JOB_NAME];

export const userDataPackageExportPayloadSchema = z.object({
  userId: z.string().uuid(),
  exportJobId: z.string().uuid(),
});

export type UserDataPackageExportPayload = z.infer<
  typeof userDataPackageExportPayloadSchema
>;

export type ExportsJobSpec = {
  name: typeof EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE;
  data: UserDataPackageExportPayload;
};

export function validateExportsJobSpec(spec: ExportsJobSpec): {
  name: ExportsQueueJobName;
  data: UserDataPackageExportPayload;
} {
  if (spec.name !== EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE) {
    throw new VsInvalidJobPayloadError(
      "exports",
      `unsupported job name: ${String(spec.name)}`,
    );
  }
  const parsed = userDataPackageExportPayloadSchema.safeParse(spec.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("exports", parsed.error.message, parsed.error);
  }
  return { name: spec.name, data: parsed.data };
}

export function parseExportsWorkerJob(job: {
  name: string;
  data: unknown;
}): ExportsJobSpec {
  if (job.name !== EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE) {
    throw new VsInvalidJobPayloadError(
      "exports",
      `unknown job name on worker: ${String(job.name)}`,
    );
  }
  const parsed = userDataPackageExportPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("exports", parsed.error.message, parsed.error);
  }
  return {
    name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
    data: parsed.data,
  };
}

// ---------------------------------------------------------------------------
// `analytics` queue — bounded recomputations over explicit time windows.
// ---------------------------------------------------------------------------

export const ANALYTICS_QUEUE_JOB_NAME = {
  /**
   * Wall-clock interval `[windowStartIso, windowEndIso]` (inclusive ordering:
   * `windowEndIso >= windowStartIso`). When `userId` is omitted the job is
   * global/operator scope; never infer scope from empty objects.
   *
   * **Dashboard bundle (`dashboard_bundle_v1`) in this deployment:** when
   * `userId` is present, the worker uses **`windowEndIso` only** as the `nowMs`
   * anchor for dashboard range SQL (`7d` / `30d` / `90d` / `all` windows are
   * computed backward from that instant). `windowStartIso` is carried in the
   * payload for forward-compatible bounded jobs but is **not** applied to clip
   * those dashboard aggregates today — producers still must send a valid
   * interval with `windowStartIso <= windowEndIso`.
   */
  WINDOWED_AGGREGATE: "windowed_aggregate",
  /**
   * Refreshes listen period rollups for one user. Default `incremental` replaces only the
   * current UTC calendar week, month, and year rows (and refreshes per-artist totals); use
   * `full` for an explicit rebuild of every bucket.
   */
  LISTEN_PERIOD_METRICS: "listen_period_metrics",
  /**
   * Recomputes Layer 1 durable evidence (currently `artist.user_relationship.v1` for the
   * rolling 30d window ending at `nowMsAnchorIso`). Scope is explicit — never inferred
   * from an empty payload.
   */
  LAYER1_EVIDENCE_RECOMPUTE: "layer1_evidence_recompute",
} as const;

export type AnalyticsQueueJobName =
  (typeof ANALYTICS_QUEUE_JOB_NAME)[keyof typeof ANALYTICS_QUEUE_JOB_NAME];

export const windowedAggregatePayloadSchema = z.object({
  windowStartIso: z.string().datetime({ offset: true }),
  windowEndIso: z.string().datetime({ offset: true }),
  userId: z.string().uuid().optional(),
});

export type WindowedAggregatePayload = z.infer<typeof windowedAggregatePayloadSchema>;

export const listenPeriodMetricsModeSchema = z.enum(["incremental", "full"]);

export type ListenPeriodMetricsMode = z.infer<typeof listenPeriodMetricsModeSchema>;

export const listenPeriodMetricsPayloadSchema = z.object({
  userId: z.string().uuid(),
  mode: listenPeriodMetricsModeSchema.default("incremental"),
});

/** Payload after validation / worker parse (`mode` defaulted). */
export type ListenPeriodMetricsPayload = z.infer<typeof listenPeriodMetricsPayloadSchema>;

/** Producer / raw job body: `mode` may be omitted (defaults to incremental). */
export type ListenPeriodMetricsPayloadInput = z.input<typeof listenPeriodMetricsPayloadSchema>;

export const layer1EvidenceRecomputeScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("explicit_user_ids"),
      userIds: z.array(z.string().uuid()).min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("user_cursor_batch"),
      cursorAfterUserId: z.string().uuid().nullable(),
      limit: z.number().int().min(1).max(500),
    })
    .strict(),
]);

export type Layer1EvidenceRecomputeScope = z.infer<typeof layer1EvidenceRecomputeScopeSchema>;

/**
 * VS-78 — explicit producer reasons for `layer1_evidence_recompute` (job payload + audit).
 * Extend only with product review so operators retain a closed vocabulary.
 */
export const LAYER1_EVIDENCE_RECOMPUTE_ENQUEUE_REASON_CODES = [
  "import_completed",
  "listen_ingested",
  "advanced_upgrade",
  "signal_version_changed",
  "nightly_reconciliation",
  "admin_manual",
  "internal_backfill",
] as const;

export const layer1EvidenceRecomputeEnqueueReasonCodeSchema = z.enum(
  LAYER1_EVIDENCE_RECOMPUTE_ENQUEUE_REASON_CODES,
);

export type Layer1EvidenceRecomputeEnqueueReasonCode = z.infer<
  typeof layer1EvidenceRecomputeEnqueueReasonCodeSchema
>;

export const layer1EvidenceRecomputePayloadSchema = z
  .object({
    nowMsAnchorIso: z.string().datetime({ offset: true }),
    scope: layer1EvidenceRecomputeScopeSchema,
    enqueueReason: layer1EvidenceRecomputeEnqueueReasonCodeSchema,
    correlationId: z.string().min(1).max(256).optional(),
    actorUserId: z.string().uuid().optional(),
    artistLimit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type Layer1EvidenceRecomputePayload = z.infer<typeof layer1EvidenceRecomputePayloadSchema>;

export type Layer1EvidenceRecomputePayloadInput = z.input<
  typeof layer1EvidenceRecomputePayloadSchema
>;

export type AnalyticsJobSpec =
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE;
      data: WindowedAggregatePayload;
    }
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS;
      data: ListenPeriodMetricsPayloadInput;
    }
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE;
      data: Layer1EvidenceRecomputePayloadInput;
    };

export type ParsedAnalyticsWorkerJob =
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE;
      data: WindowedAggregatePayload;
    }
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS;
      data: ListenPeriodMetricsPayload;
    }
  | {
      name: typeof ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE;
      data: Layer1EvidenceRecomputePayload;
    };

export function validateAnalyticsJobSpec(spec: AnalyticsJobSpec): ParsedAnalyticsWorkerJob {
  if (spec.name === ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE) {
    const parsed = windowedAggregatePayloadSchema.safeParse(spec.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError("analytics", parsed.error.message, parsed.error);
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
      data: parsed.data,
    };
  }
  if (spec.name === ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS) {
    const parsed = listenPeriodMetricsPayloadSchema.safeParse(spec.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError("analytics", parsed.error.message, parsed.error);
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS,
      data: parsed.data,
    };
  }
  if (spec.name === ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
    const parsed = layer1EvidenceRecomputePayloadSchema.safeParse(spec.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError("analytics", parsed.error.message, parsed.error);
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
      data: parsed.data,
    };
  }
  throw new VsInvalidJobPayloadError(
    "analytics",
    `unsupported job name: ${String((spec as { name: string }).name)}`,
  );
}

export function parseAnalyticsWorkerJob(job: {
  name: string;
  data: unknown;
}): ParsedAnalyticsWorkerJob {
  if (job.name === ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE) {
    const parsed = windowedAggregatePayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError(
        "analytics",
        parsed.error.message,
        parsed.error,
      );
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
      data: parsed.data,
    };
  }
  if (job.name === ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS) {
    const parsed = listenPeriodMetricsPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError(
        "analytics",
        parsed.error.message,
        parsed.error,
      );
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS,
      data: parsed.data,
    };
  }
  if (job.name === ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
    const parsed = layer1EvidenceRecomputePayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new VsInvalidJobPayloadError(
        "analytics",
        parsed.error.message,
        parsed.error,
      );
    }
    return {
      name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
      data: parsed.data,
    };
  }
  throw new VsInvalidJobPayloadError(
    "analytics",
    `unknown job name on worker: ${String(job.name)}`,
  );
}

// ---------------------------------------------------------------------------
// `sync` queue — explicit listen / catalogue catch-up triggers.
// ---------------------------------------------------------------------------

export const SYNC_QUEUE_JOB_NAME = {
  /**
   * Drive incremental Last.fm sync for one user. `trigger` records whether the
   * scheduler or a user action enqueued the job — do not infer from timestamps.
   */
  LISTEN_CATCHUP: "listen_catchup",
} as const;

export type SyncQueueJobName =
  (typeof SYNC_QUEUE_JOB_NAME)[keyof typeof SYNC_QUEUE_JOB_NAME];

export const listenCatchupPayloadSchema = z.object({
  userId: z.string().uuid(),
  trigger: z.enum(["scheduled", "manual"]),
});

export type ListenCatchupPayload = z.infer<typeof listenCatchupPayloadSchema>;

export type SyncJobSpec = {
  name: typeof SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP;
  data: ListenCatchupPayload;
};

export function validateSyncJobSpec(spec: SyncJobSpec): {
  name: SyncQueueJobName;
  data: ListenCatchupPayload;
} {
  if (spec.name !== SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP) {
    throw new VsInvalidJobPayloadError(
      "sync",
      `unsupported job name: ${String(spec.name)}`,
    );
  }
  const parsed = listenCatchupPayloadSchema.safeParse(spec.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("sync", parsed.error.message, parsed.error);
  }
  return { name: spec.name, data: parsed.data };
}

export function parseSyncWorkerJob(job: {
  name: string;
  data: unknown;
}): SyncJobSpec {
  if (job.name !== SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP) {
    throw new VsInvalidJobPayloadError(
      "sync",
      `unknown job name on worker: ${String(job.name)}`,
    );
  }
  const parsed = listenCatchupPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError("sync", parsed.error.message, parsed.error);
  }
  return {
    name: SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP,
    data: parsed.data,
  };
}

// ---------------------------------------------------------------------------
// `incremental_sync` queue — `system_sync` import rows (bounded Last.fm delta).
// ---------------------------------------------------------------------------

export const INCREMENTAL_SYNC_QUEUE_JOB_NAME = {
  /**
   * Run incremental Last.fm sync for one queued `import_jobs` row with
   * `source = 'system_sync'`. Worker loads checkpoints from the database.
   */
  SYSTEM_SYNC_RUN: "system_sync_run",
} as const;

export type IncrementalSyncQueueJobName =
  (typeof INCREMENTAL_SYNC_QUEUE_JOB_NAME)[keyof typeof INCREMENTAL_SYNC_QUEUE_JOB_NAME];

export const systemSyncRunPayloadSchema = z.object({
  importJobId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type SystemSyncRunPayload = z.infer<typeof systemSyncRunPayloadSchema>;

export type IncrementalSyncJobSpec = {
  name: typeof INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN;
  data: SystemSyncRunPayload;
};

export function validateIncrementalSyncJobSpec(spec: IncrementalSyncJobSpec): {
  name: IncrementalSyncQueueJobName;
  data: SystemSyncRunPayload;
} {
  if (spec.name !== INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN) {
    throw new VsInvalidJobPayloadError(
      "incremental_sync",
      `unsupported job name: ${String(spec.name)}`,
    );
  }
  const parsed = systemSyncRunPayloadSchema.safeParse(spec.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError(
      "incremental_sync",
      parsed.error.message,
      parsed.error,
    );
  }
  return { name: spec.name, data: parsed.data };
}

export function parseIncrementalSyncWorkerJob(job: {
  name: string;
  data: unknown;
}): IncrementalSyncJobSpec {
  if (job.name !== INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN) {
    throw new VsInvalidJobPayloadError(
      "incremental_sync",
      `unknown job name on worker: ${String(job.name)}`,
    );
  }
  const parsed = systemSyncRunPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new VsInvalidJobPayloadError(
      "incremental_sync",
      parsed.error.message,
      parsed.error,
    );
  }
  return {
    name: INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
    data: parsed.data,
  };
}
