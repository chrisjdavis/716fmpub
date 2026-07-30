/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- VS-45: first-class insufficiency + comparability metadata on durable Layer 1 rows
-- (avoids inferring eligibility only from body_json or ambiguous all-null columns).
ALTER TABLE layer1_evidence_objects
  ADD COLUMN insufficiency_evaluation_as_of_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN eligible_for_downstream_use boolean NOT NULL DEFAULT true,
  ADD COLUMN insufficiency_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN insufficiency_structured_factors jsonb NULL,
  ADD COLUMN comparability_metric_family text NOT NULL DEFAULT 'unknown',
  ADD COLUMN comparable_within_user boolean NOT NULL DEFAULT true,
  ADD COLUMN comparable_across_users boolean NOT NULL DEFAULT false,
  ADD COLUMN comparable_within_artist_entity boolean NOT NULL DEFAULT false,
  ADD COLUMN comparable_across_temporal_windows_same_grain boolean NOT NULL DEFAULT false,
  ADD COLUMN comparable_to_prior_window_same_grain boolean NOT NULL DEFAULT false,
  ADD COLUMN comparable_to_year_ago_window_same_grain boolean NOT NULL DEFAULT false;

ALTER TABLE layer1_evidence_objects
  ADD CONSTRAINT layer1_evidence_objects_insufficiency_codes_chk CHECK (
    eligible_for_downstream_use
    OR cardinality(insufficiency_codes) >= 1
  );

ALTER TABLE layer1_evidence_objects
  ADD CONSTRAINT layer1_evidence_objects_metric_family_len_chk CHECK (
    char_length(comparability_metric_family) >= 1
    AND char_length(comparability_metric_family) <= 256
  );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE layer1_evidence_objects
  DROP CONSTRAINT IF EXISTS layer1_evidence_objects_metric_family_len_chk;

ALTER TABLE layer1_evidence_objects
  DROP CONSTRAINT IF EXISTS layer1_evidence_objects_insufficiency_codes_chk;

ALTER TABLE layer1_evidence_objects
  DROP COLUMN IF EXISTS comparable_to_year_ago_window_same_grain,
  DROP COLUMN IF EXISTS comparable_to_prior_window_same_grain,
  DROP COLUMN IF EXISTS comparable_across_temporal_windows_same_grain,
  DROP COLUMN IF EXISTS comparable_within_artist_entity,
  DROP COLUMN IF EXISTS comparable_across_users,
  DROP COLUMN IF EXISTS comparable_within_user,
  DROP COLUMN IF EXISTS comparability_metric_family,
  DROP COLUMN IF EXISTS insufficiency_structured_factors,
  DROP COLUMN IF EXISTS insufficiency_codes,
  DROP COLUMN IF EXISTS eligible_for_downstream_use,
  DROP COLUMN IF EXISTS insufficiency_evaluation_as_of_ms;
  `);
};
