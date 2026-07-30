/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
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

DROP TRIGGER IF EXISTS listens_notify_listen_change ON listens;

CREATE TRIGGER listens_notify_listen_change
  AFTER INSERT OR DELETE ON listens
  FOR EACH ROW
  EXECUTE FUNCTION notify_listen_change ();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP TRIGGER IF EXISTS listens_notify_listen_change ON listens;
DROP FUNCTION IF EXISTS notify_listen_change ();
  `);
};
