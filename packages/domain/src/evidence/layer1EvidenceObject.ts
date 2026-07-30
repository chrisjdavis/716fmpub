import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "./jsonValue.js";

/** Bump only for breaking wire/schema changes to `Layer1EvidenceObject`. */
export const LAYER1_EVIDENCE_SCHEMA_VERSION = 1 as const;

/** Wire `format` discriminator for structured JSON payloads (`Layer1JsonPayload`). */
export const LAYER1_JSON_PAYLOAD_FORMAT_V1 = "716fm.layer1.json_payload_v1" as const;

/**
 * Canonical machine tokens for insufficiency / eligibility (non-prose).
 * Additional codes may appear at runtime; downstream layers should treat
 * unknown codes as opaque eligibility hints.
 */
export const LAYER1_INSUFFICIENCY_CODES = [
  "OK",
  "INSUFFICIENT_SAMPLE",
  "STALE_SOURCE",
  "MISSING_SOURCE",
  "PARTIAL_COVERAGE",
  "POLICY_EXCLUDED",
  "UNKNOWN_ELIGIBILITY",
] as const;

export type Layer1InsufficiencyCode =
  (typeof LAYER1_INSUFFICIENCY_CODES)[number];

const temporalWindowMsSchema = z
  .object({
    /** Inclusive UTC epoch ms. */
    startInclusiveMs: z.number().int().nonnegative(),
    /** Exclusive UTC epoch ms; must be strictly greater than start. */
    endExclusiveMs: z.number().int().positive(),
  })
  .strict()
  .superRefine((w, ctx) => {
    if (w.endExclusiveMs <= w.startInclusiveMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endExclusiveMs must be greater than startInclusiveMs",
        path: ["endExclusiveMs"],
      });
    }
  });

const artistEntityRefSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("lastfm_artist_mbid"),
        mbid: z.string().uuid(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("lastfm_artist_url_key"),
        /** Normalized Last.fm artist URL key (opaque string, not a sentence). */
        urlKey: z.string().min(1).max(512),
      })
      .strict(),
  ])
  .describe("Machine-stable artist identity for entity-scoped evidence.");

const evidenceScopeSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("user"),
        userId: z.string().uuid(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("artist"),
        userId: z.string().uuid(),
        artistEntity: artistEntityRefSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("window"),
        userId: z.string().uuid(),
        temporalWindowMs: temporalWindowMsSchema,
        /** When present, window evidence is additionally tied to this artist. */
        artistEntity: artistEntityRefSchema.optional(),
      })
      .strict(),
  ])
  .describe(
    "Primary grain: user aggregate, user+artist, or user+time window (optional artist).",
  );

const layer1JsonPayloadSchema = z
  .object({
    format: z.literal(LAYER1_JSON_PAYLOAD_FORMAT_V1),
    /** Structured fields only; no narrative prose keys in contract tests. */
    data: z.record(z.string(), jsonValueSchema),
  })
  .strict();

const comparabilityFlagsSchema = z
  .object({
    metricFamily: z
      .string()
      .min(1)
      .max(256)
      .describe("Opaque family id so rankers can bucket comparable signals."),
    comparableWithinUser: z.boolean(),
    comparableAcrossUsers: z.boolean(),
    comparableWithinArtistEntity: z.boolean(),
    comparableAcrossTemporalWindowsOfSameGrain: z.boolean(),
    /**
     * Explicit: this windowed signal may be compared to the immediately prior window
     * of the same grain without fabricating a missing peer value.
     */
    comparableToPriorWindowSameGrain: z.boolean().default(false),
    /**
     * Explicit: this windowed signal may be compared to a year-ago offset window
     * of the same grain without fabricating a missing peer value.
     */
    comparableToYearAgoWindowSameGrain: z.boolean().default(false),
  })
  .strict();

const insufficiencySchema = z
  .object({
    evaluationAsOfMs: z.number().int().nonnegative(),
    eligibleForDownstreamUse: z.boolean(),
    codes: z.array(z.string().min(1)).describe("Machine tokens; non-empty when ineligible."),
    structuredFactors: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.eligibleForDownstreamUse && v.codes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When eligibleForDownstreamUse is false, codes must list at least one machine token.",
        path: ["codes"],
      });
    }
  });

const deterministicScoresSchema = z
  .object({
    /** Finite numeric scores only; keys are opaque snake_case identifiers. */
    values: z.record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,63}$/, {
          message: "score key must be snake_case [a-z][a-z0-9_]*",
        }),
      z.number().finite(),
    ),
    /** Optional unit label per score key (machine token, not a sentence). */
    unitByScoreKey: z
      .record(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]{0,63}$/),
        z.string().min(1).max(64),
      )
      .optional(),
  })
  .strict();

export const layer1EvidenceObjectSchema = z
  .object({
    schemaVersion: z.literal(LAYER1_EVIDENCE_SCHEMA_VERSION),
    /** Unique id for this materialized signal instance (dedupe / tracing). */
    signalInstanceId: z.string().uuid(),
    /** Stable signal recipe id (e.g. listen_count_total). */
    signalKind: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9_.-]*$/, {
        message: "signalKind must be a machine slug",
      }),
    /** Version of the signal definition / extractor that produced this row. */
    signalDefinitionVersion: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[0-9A-Za-z._+-]+$/, {
        message: "signalDefinitionVersion must be an opaque version token",
      }),
    /** Wall-clock ms when this evidence object was emitted. */
    emittedAtMs: z.number().int().nonnegative(),
    /**
     * Latest source observation time reflected in payload (staleness bound).
     * Must be <= emittedAtMs in validated objects.
     */
    sourceObservedThroughMs: z.number().int().nonnegative(),
    scope: evidenceScopeSchema,
    payload: layer1JsonPayloadSchema,
    comparability: comparabilityFlagsSchema,
    insufficiency: insufficiencySchema,
    deterministicScores: deterministicScoresSchema.optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.sourceObservedThroughMs > o.emittedAtMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceObservedThroughMs must not be after emittedAtMs",
        path: ["sourceObservedThroughMs"],
      });
    }
  });

export type Layer1EvidenceScope = z.infer<typeof evidenceScopeSchema>;
export type Layer1EvidenceObject = z.infer<typeof layer1EvidenceObjectSchema>;
export type Layer1JsonPayload = z.infer<typeof layer1JsonPayloadSchema>;
export type Layer1ComparabilityFlags = z.infer<typeof comparabilityFlagsSchema>;
export type Layer1Insufficiency = z.infer<typeof insufficiencySchema>;
export type Layer1DeterministicScores = z.infer<
  typeof deterministicScoresSchema
>;
export type { JsonValue };

/**
 * Parse and validate a wire JSON value as a Layer 1 evidence object.
 * Returns a discriminated result; callers must handle failure explicitly.
 */
export function parseLayer1EvidenceObject(
  input: unknown,
):
  | { ok: true; value: Layer1EvidenceObject }
  | { ok: false; error: z.ZodError } {
  const parsed = layer1EvidenceObjectSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: parsed.error };
}

export function assertLayer1EvidenceObject(input: unknown): Layer1EvidenceObject {
  return layer1EvidenceObjectSchema.parse(input);
}
