/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- 716FM AI Layer 1 — durable evidence rows + job/run provenance (additive; analytics_snapshots remains for replace-upsert slots).
CREATE TABLE layer1_signal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  started_at timestamptz NOT NULL DEFAULT now (),
  completed_at timestamptz NULL,
  status text NOT NULL,
  pipeline text NOT NULL DEFAULT 'layer1',
  trigger_kind text NOT NULL,
  correlation_id text NULL,
  actor_user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  error_code text NULL,
  error_detail text NULL,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT layer1_signal_runs_status_check CHECK (status IN (
    'running',
    'succeeded',
    'failed',
    'cancelled'
  )),
  CONSTRAINT layer1_signal_runs_pipeline_check CHECK (char_length (pipeline) >= 1 AND char_length (pipeline) <= 128),
  CONSTRAINT layer1_signal_runs_trigger_kind_check CHECK (char_length (trigger_kind) >= 1 AND char_length (trigger_kind) <= 128),
  CONSTRAINT layer1_signal_runs_correlation_id_len CHECK (
    correlation_id IS NULL OR (char_length (correlation_id) >= 1 AND char_length (correlation_id) <= 256)
  ),
  CONSTRAINT layer1_signal_runs_error_code_len CHECK (
    error_code IS NULL OR (char_length (error_code) >= 1 AND char_length (error_code) <= 128)
  ),
  CONSTRAINT layer1_signal_runs_error_detail_len CHECK (
    error_detail IS NULL OR char_length (error_detail) <= 4000
  ),
  CONSTRAINT layer1_signal_runs_completed_consistency_chk CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX layer1_signal_runs_started_at_idx
  ON layer1_signal_runs (started_at DESC);

CREATE INDEX layer1_signal_runs_actor_started_idx
  ON layer1_signal_runs (actor_user_id, started_at DESC);

CREATE INDEX layer1_signal_runs_pipeline_status_started_idx
  ON layer1_signal_runs (pipeline, status, started_at DESC);

CREATE TABLE layer1_evidence_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  created_at timestamptz NOT NULL DEFAULT now (),
  layer1_signal_run_id uuid NULL REFERENCES layer1_signal_runs (id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  signal_instance_id uuid NOT NULL,
  signal_kind text NOT NULL,
  signal_definition_version text NOT NULL,
  evidence_schema_version smallint NOT NULL,
  scope_kind text NOT NULL,
  window_start_ms bigint NULL,
  window_end_ms bigint NULL,
  artist_entity_kind text NULL,
  artist_mbid uuid NULL,
  artist_url_key text NULL,
  scope_json jsonb NOT NULL,
  body_json jsonb NOT NULL,
  CONSTRAINT layer1_evidence_objects_signal_instance_id_key UNIQUE (signal_instance_id),
  CONSTRAINT layer1_evidence_objects_scope_kind_check CHECK (scope_kind IN ('user', 'artist', 'window')),
  CONSTRAINT layer1_evidence_objects_signal_kind_len CHECK (
    char_length (signal_kind) >= 1 AND char_length (signal_kind) <= 128
  ),
  CONSTRAINT layer1_evidence_objects_signal_def_ver_len CHECK (
    char_length (signal_definition_version) >= 1 AND char_length (signal_definition_version) <= 64
  ),
  CONSTRAINT layer1_evidence_objects_artist_entity_kind_check CHECK (
    artist_entity_kind IS NULL
    OR artist_entity_kind IN ('lastfm_artist_mbid', 'lastfm_artist_url_key')
  ),
  CONSTRAINT layer1_evidence_objects_scope_window_ms_chk CHECK (
    (scope_kind <> 'window')
    OR (
      window_start_ms IS NOT NULL
      AND window_end_ms IS NOT NULL
      AND window_end_ms > window_start_ms
    )
  ),
  CONSTRAINT layer1_evidence_objects_scope_user_cols_chk CHECK (
    (scope_kind <> 'user')
    OR (
      window_start_ms IS NULL
      AND window_end_ms IS NULL
      AND artist_entity_kind IS NULL
      AND artist_mbid IS NULL
      AND artist_url_key IS NULL
    )
  ),
  CONSTRAINT layer1_evidence_objects_scope_artist_cols_chk CHECK (
    (scope_kind <> 'artist')
    OR (
      window_start_ms IS NULL
      AND window_end_ms IS NULL
      AND artist_entity_kind IS NOT NULL
      AND (
        (
          artist_entity_kind = 'lastfm_artist_mbid'
          AND artist_mbid IS NOT NULL
          AND artist_url_key IS NULL
        )
        OR (
          artist_entity_kind = 'lastfm_artist_url_key'
          AND artist_url_key IS NOT NULL
          AND artist_mbid IS NULL
        )
      )
    )
  ),
  CONSTRAINT layer1_evidence_objects_scope_window_artist_chk CHECK (
    (scope_kind <> 'window')
    OR (
      artist_entity_kind IS NULL
      OR (
        (
          artist_entity_kind = 'lastfm_artist_mbid'
          AND artist_mbid IS NOT NULL
          AND artist_url_key IS NULL
        )
        OR (
          artist_entity_kind = 'lastfm_artist_url_key'
          AND artist_url_key IS NOT NULL
          AND artist_mbid IS NULL
        )
      )
    )
  )
);

CREATE INDEX layer1_evidence_objects_user_created_idx
  ON layer1_evidence_objects (user_id, created_at DESC);

CREATE INDEX layer1_evidence_objects_user_signal_created_idx
  ON layer1_evidence_objects (user_id, signal_kind, created_at DESC);

CREATE INDEX layer1_evidence_objects_user_signal_def_created_idx
  ON layer1_evidence_objects (user_id, signal_kind, signal_definition_version, created_at DESC);

CREATE INDEX layer1_evidence_objects_user_scope_window_idx
  ON layer1_evidence_objects (user_id, window_start_ms, window_end_ms)
  WHERE scope_kind = 'window';

CREATE INDEX layer1_evidence_objects_user_artist_mbid_idx
  ON layer1_evidence_objects (user_id, artist_mbid)
  WHERE artist_mbid IS NOT NULL;

CREATE INDEX layer1_evidence_objects_user_artist_url_key_idx
  ON layer1_evidence_objects (user_id, artist_url_key)
  WHERE artist_url_key IS NOT NULL;

CREATE INDEX layer1_evidence_objects_run_idx
  ON layer1_evidence_objects (layer1_signal_run_id)
  WHERE layer1_signal_run_id IS NOT NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS layer1_evidence_objects_run_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_artist_url_key_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_artist_mbid_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_scope_window_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_signal_def_created_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_signal_created_idx;
DROP INDEX IF EXISTS layer1_evidence_objects_user_created_idx;

DROP TABLE IF EXISTS layer1_evidence_objects;

DROP INDEX IF EXISTS layer1_signal_runs_pipeline_status_started_idx;
DROP INDEX IF EXISTS layer1_signal_runs_actor_started_idx;
DROP INDEX IF EXISTS layer1_signal_runs_started_at_idx;

DROP TABLE IF EXISTS layer1_signal_runs;
  `);
};
