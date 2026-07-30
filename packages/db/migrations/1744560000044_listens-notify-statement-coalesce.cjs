/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
DROP TRIGGER IF EXISTS listens_notify_listen_change ON listens;
DROP FUNCTION IF EXISTS notify_listen_change ();

CREATE OR REPLACE FUNCTION notify_listen_change_insert ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  uid uuid;
BEGIN
  FOR uid IN
  SELECT DISTINCT
    user_id
  FROM
    new_rows
    LOOP
      PERFORM
        pg_notify('listen_change', json_build_object('user_id', uid::text)::text);
    END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION notify_listen_change_delete ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  uid uuid;
BEGIN
  FOR uid IN
  SELECT DISTINCT
    user_id
  FROM
    old_rows
    LOOP
      PERFORM
        pg_notify('listen_change', json_build_object('user_id', uid::text)::text);
    END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER listens_notify_listen_change_insert
  AFTER INSERT ON listens
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION notify_listen_change_insert ();

CREATE TRIGGER listens_notify_listen_change_delete
  AFTER DELETE ON listens
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION notify_listen_change_delete ();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP TRIGGER IF EXISTS listens_notify_listen_change_insert ON listens;
DROP TRIGGER IF EXISTS listens_notify_listen_change_delete ON listens;
DROP FUNCTION IF EXISTS notify_listen_change_insert ();
DROP FUNCTION IF EXISTS notify_listen_change_delete ();

CREATE OR REPLACE FUNCTION notify_listen_change ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  uid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    uid := NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    uid := OLD.user_id;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM pg_notify(
    'listen_change',
    json_build_object('user_id', uid::text)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER listens_notify_listen_change
  AFTER INSERT OR DELETE ON listens
  FOR EACH ROW
  EXECUTE FUNCTION notify_listen_change ();
  `);
};
