-- Phase 3A. Run ONCE as owner on the DEVELOPMENT branch after migration 003.
-- This choice covers LOCAL PREVIEW ONLY. It does not authorize face matching.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version='003') THEN
    RAISE EXCEPTION 'Apply migration 003 first.';
  END IF;
  IF EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version='004') THEN
    RAISE EXCEPTION 'Migration 004 is already recorded. Do not rerun or drop objects.';
  END IF;
END $$;
CREATE TABLE attendai.camera_notices (
  version text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose='local_camera_preview'),
  title text NOT NULL,
  body text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE UNIQUE INDEX camera_notice_one_current ON attendai.camera_notices(is_current) WHERE is_current;
INSERT INTO attendai.camera_notices(version,purpose,title,body,is_current) VALUES
('camera-preview-2026-10-22','local_camera_preview','Optional local camera preview',
E'This optional trial displays a live camera preview on this device for up to 60 seconds at a time. It requests video only. No frames, recordings, face templates, or microphone audio are uploaded or saved by this feature.\n\nYour choice applies only to this local preview. Face matching and liveness detection are not available. Any future face-verification enrollment will need a separate notice and a fresh choice.\n\nManual attendance remains available, and choosing it does not change your attendance. You may withdraw here at any time. The app stops its preview tracks when you stop, withdraw, hide this page, leave it, or the preview times out. Other apps or tabs may still use your camera.\n\nAdministrators can read current choices. Teachers can read choices for students in their assigned courses. Your choice history is visible to your own account through this interface.\n\nA preview choice lasts 30 days, or until withdrawn or replaced by a new notice. The database stores your student link, choice, notice version, server timestamps, and revision history. Choice history remains in this development database. Automated retention and deletion are not implemented. Use synthetic accounts for this research prototype.',true);
CREATE TABLE attendai.camera_choices (
  student_id uuid PRIMARY KEY REFERENCES attendai.students(id) ON DELETE RESTRICT,
  notice_version text NOT NULL REFERENCES attendai.camera_notices(version) ON DELETE RESTRICT,
  choice text NOT NULL CHECK (choice IN ('granted','manual','withdrawn')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  decided_at timestamptz NOT NULL DEFAULT current_timestamp,
  expires_at timestamptz,
  CHECK ((choice='granted') = (expires_at IS NOT NULL))
);
CREATE TABLE attendai.camera_choice_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES attendai.students(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision>=1),
  notice_version text NOT NULL REFERENCES attendai.camera_notices(version) ON DELETE RESTRICT,
  previous_choice text CHECK (previous_choice IN ('granted','manual','withdrawn')),
  new_choice text NOT NULL CHECK (new_choice IN ('granted','manual','withdrawn')),
  actor_id uuid NOT NULL REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz,
  UNIQUE(student_id,revision)
);
ALTER TABLE attendai.camera_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.camera_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.camera_choice_events ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION attendai.current_camera_notice() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$ SELECT version FROM attendai.camera_notices WHERE is_current $$;
CREATE POLICY camera_notice_read ON attendai.camera_notices FOR SELECT TO attendai_app
  USING (attendai.actor_role() IS NOT NULL);
CREATE POLICY camera_choice_read ON attendai.camera_choices FOR SELECT TO attendai_app
  USING (attendai.read_student(student_id));
CREATE POLICY camera_choice_add ON attendai.camera_choices FOR INSERT TO attendai_app
  WITH CHECK (attendai.actor_role()='student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id=student_id AND s.user_id=attendai.actor_id() AND (choice<>'granted' OR s.is_active)));
CREATE POLICY camera_choice_change ON attendai.camera_choices FOR UPDATE TO attendai_app
  USING (attendai.actor_role()='student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id=student_id AND s.user_id=attendai.actor_id()))
  WITH CHECK (attendai.actor_role()='student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id=student_id AND s.user_id=attendai.actor_id() AND (choice<>'granted' OR s.is_active)));
CREATE POLICY camera_history_read ON attendai.camera_choice_events FOR SELECT TO attendai_app
  USING (attendai.actor_role()='student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id=student_id AND s.user_id=attendai.actor_id()));
CREATE FUNCTION attendai.prepare_camera_choice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
  IF attendai.actor_role() IS DISTINCT FROM 'student' OR NOT EXISTS
    (SELECT 1 FROM attendai.students WHERE id=NEW.student_id AND user_id=attendai.actor_id() AND (NEW.choice<>'granted' OR is_active)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the linked active student may choose.';
  END IF;
  IF NEW.notice_version IS DISTINCT FROM attendai.current_camera_notice() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='The camera notice changed. Review the current notice before enabling preview.';
  END IF;
  IF TG_OP='UPDATE' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Camera choice identity cannot change.';
  END IF;
  NEW.revision := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
  NEW.decided_at := clock_timestamp();
  NEW.expires_at := CASE WHEN NEW.choice='granted' THEN NEW.decided_at + interval '30 days' ELSE NULL END;
  RETURN NEW;
END $$;
CREATE FUNCTION attendai.append_camera_choice_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO attendai.camera_choice_events(student_id,revision,notice_version,previous_choice,new_choice,actor_id,occurred_at,expires_at)
  VALUES(NEW.student_id,NEW.revision,NEW.notice_version,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.choice END,
    NEW.choice,attendai.actor_id(),NEW.decided_at,NEW.expires_at);
  RETURN NEW;
END $$;
CREATE TRIGGER camera_choice_prepare BEFORE INSERT OR UPDATE ON attendai.camera_choices
  FOR EACH ROW EXECUTE FUNCTION attendai.prepare_camera_choice();
CREATE TRIGGER camera_choice_receipt AFTER INSERT OR UPDATE ON attendai.camera_choices
  FOR EACH ROW EXECUTE FUNCTION attendai.append_camera_choice_event();
CREATE TRIGGER camera_choice_no_delete BEFORE DELETE ON attendai.camera_choices
  FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER camera_choice_no_truncate BEFORE TRUNCATE ON attendai.camera_choices
  FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER camera_event_no_mutation BEFORE UPDATE OR DELETE ON attendai.camera_choice_events
  FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER camera_event_no_truncate BEFORE TRUNCATE ON attendai.camera_choice_events
  FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE FUNCTION attendai.preserve_camera_notice() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Publish a new camera notice version instead of rewriting its content.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER camera_notice_preserve BEFORE UPDATE ON attendai.camera_notices
  FOR EACH ROW EXECUTE FUNCTION attendai.preserve_camera_notice();
REVOKE ALL ON attendai.camera_notices,attendai.camera_choices,attendai.camera_choice_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE attendai.camera_choice_events_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION attendai.current_camera_notice(),attendai.prepare_camera_choice(),attendai.append_camera_choice_event(),attendai.preserve_camera_notice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendai.current_camera_notice() TO attendai_app;
GRANT SELECT ON attendai.camera_notices,attendai.camera_choices,attendai.camera_choice_events TO attendai_app;
GRANT INSERT(student_id,notice_version,choice),UPDATE(notice_version,choice) ON attendai.camera_choices TO attendai_app;
INSERT INTO attendai.schema_migrations(version,description)
VALUES('004','Versioned local camera choices and private preview readiness');
COMMIT;
SELECT 'Schema 004 applied' AS result,
  (SELECT count(*)::int FROM attendai.schema_migrations WHERE version IN ('001','002','003','004')) AS migrations_recorded;
