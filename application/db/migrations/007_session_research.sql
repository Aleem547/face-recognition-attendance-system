-- Owner-only migration after 006. Research context only: never writes attendance.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='006') THEN RAISE EXCEPTION 'Apply migration 006 first.'; END IF;
 IF EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='007') THEN RAISE EXCEPTION 'Migration 007 already exists.'; END IF;
END $$;
ALTER TABLE attendai.verification_attempts ADD COLUMN session_id uuid REFERENCES attendai.sessions(id),
 ADD COLUMN session_notice_version text CHECK(session_notice_version='session-research-v1');
ALTER TABLE attendai.verification_trials ADD COLUMN session_id uuid REFERENCES attendai.sessions(id);
ALTER TABLE attendai.verification_events ADD COLUMN session_id uuid REFERENCES attendai.sessions(id),
 ADD COLUMN session_notice_version text CHECK(session_notice_version='session-research-v1');
-- Locks survive until commit. Session locks also serialize manual mark insertion,
-- whose existing guard locks the same session. Dates remain descriptive: the
-- existing staff-controlled 'open' state is authoritative for this rehearsal.
CREATE FUNCTION attendai.assert_session_research(sid uuid,session uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cid uuid; uid uuid; ok boolean;
BEGIN
 IF NOT attendai.own_biometric(sid) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 SELECT course_id,state='open' INTO cid,ok FROM attendai.sessions WHERE id=session FOR SHARE;
 IF cid IS NULL OR NOT ok THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 PERFORM 1 FROM attendai.courses WHERE id=cid AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 SELECT user_id INTO uid FROM attendai.students WHERE id=sid AND is_active AND user_id=attendai.actor_id() FOR SHARE;
 IF uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 PERFORM 1 FROM attendai.app_users WHERE id=uid AND is_active AND role='student' AND auth_provider='better-auth' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 PERFORM 1 FROM attendai.enrollments WHERE course_id=cid AND student_id=sid AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.'; END IF;
 PERFORM 1 FROM attendai.session_roster WHERE session_id=session AND course_id=cid AND student_id=sid FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM attendai.attendance_records WHERE session_id=session AND student_id=sid) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Session research unavailable.';
 END IF;
END $$;
CREATE FUNCTION attendai.guard_session_research_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.session_notice_version IS DISTINCT FROM OLD.session_notice_version) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Research context is immutable.';
 END IF;
 IF NEW.session_id IS NOT NULL THEN
  IF TG_OP='INSERT' OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
   PERFORM attendai.assert_session_research(NEW.student_id,NEW.session_id);
  END IF;
  NEW.session_notice_version:='session-research-v1';
 ELSE NEW.session_notice_version:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_session_research_attempt BEFORE INSERT OR UPDATE ON attendai.verification_attempts
 FOR EACH ROW EXECUTE FUNCTION attendai.guard_session_research_attempt();
CREATE FUNCTION attendai.guard_session_research_trial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 SELECT a.session_id INTO NEW.session_id FROM attendai.verification_attempts a WHERE a.token_hash=NEW.token_hash;
 IF NEW.session_id IS NOT NULL THEN PERFORM attendai.assert_session_research(NEW.student_id,NEW.session_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_session_research_trial BEFORE INSERT ON attendai.verification_trials
 FOR EACH ROW EXECUTE FUNCTION attendai.guard_session_research_trial();
-- Existing comparison receipts now retain immutable contextual metadata, not PAD
-- scores, images, or features. Old receipts remain unchanged with null context.
CREATE OR REPLACE FUNCTION attendai.record_verification_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO attendai.verification_events(student_id,event_type,notice_version,choice_revision,trial_id,actor_id,session_id,session_notice_version)
  VALUES(NEW.student_id,'compared',NEW.notice_version,NEW.choice_revision,NEW.trial_id,attendai.actor_id(),NEW.session_id,CASE WHEN NEW.session_id IS NOT NULL THEN 'session-research-v1' END);RETURN NEW;
 END IF;
 INSERT INTO attendai.verification_events(student_id,event_type,notice_version,choice_revision,trial_id,actor_id,session_id,session_notice_version)
 VALUES(OLD.student_id,'result_deleted',OLD.notice_version,OLD.choice_revision,OLD.trial_id,attendai.actor_id(),OLD.session_id,CASE WHEN OLD.session_id IS NOT NULL THEN 'session-research-v1' END);RETURN OLD;
END $$;
GRANT INSERT(session_id) ON attendai.verification_attempts TO attendai_app;
REVOKE ALL ON FUNCTION attendai.assert_session_research(uuid,uuid),attendai.guard_session_research_attempt(),attendai.guard_session_research_trial() FROM PUBLIC;
-- No new runtime function privileges or attendance DML grants.
INSERT INTO attendai.schema_migrations(version,description) VALUES('007','Optional session-bound comparison research; attendance unchanged');
COMMIT;
