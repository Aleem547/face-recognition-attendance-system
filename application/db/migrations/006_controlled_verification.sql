-- Trusted owner setup after 005. No consent grants or attendance changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='005') THEN RAISE EXCEPTION 'Apply migration 005 first.'; END IF;
 IF EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='006') THEN RAISE EXCEPTION 'Migration 006 already exists.'; END IF;
END $$;
CREATE TABLE attendai.verification_notices(
 version text PRIMARY KEY,purpose text NOT NULL CHECK(purpose='one_to_one_face_comparison'),title text NOT NULL,body text NOT NULL,
 is_current boolean NOT NULL DEFAULT false,published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX verification_one_notice ON attendai.verification_notices(is_current) WHERE is_current;
INSERT INTO attendai.verification_notices(version,purpose,title,body,is_current) VALUES
('face-verification-2026-10-25','one_to_one_face_comparison','Optional one-to-one face comparison',
E'This separate, voluntary research choice allows a new capture to be compared only with the encrypted template saved by your own linked student account. Enrollment consent alone does not authorize comparison. Manual attendance remains available on equal terms. You need an active enrollment grant and template as well as this separate comparison grant. Granting does not start the camera or send an image.\n\nStart camera opens a preview. Capture and compare explicitly sends one JPEG frame to this Face Recognition Attendance System server and stops the camera. A CPU process checks for one sufficiently clear face and derives a temporary numerical feature. The server decrypts your reference template in memory and computes cosine similarity. The application does not save the frame or probe feature to files or the database. Staff and browsers cannot obtain reference templates through this feature. Server operators with the encryption key and database access could decrypt stored templates.\n\nThe displayed score is an experimental similarity value, not a probability, accuracy percentage, identity verification, or attendance decision. This prototype has no liveness or spoof-resistance guarantee. Use only your own face voluntarily. Do not use another person\u2019s image or try to identify strangers. Accuracy must be evaluated with separately consented or licensed, labelled data before any decision threshold is adopted.\n\nYour comparison grant expires after 30 days. A comparison also requires the current enrollment grant and template, which may expire earlier. Your score, model version, reference identifier, consent revision and server timestamps are saved with an expiry of at most seven days, or until either grant or the template expires, whichever comes first. Only your linked student account can view your recent scores through this feature.\n\nWithdraw comparison, Use manual attendance, or Delete comparison results removes active score results and cancels pending comparison attempts. Withdrawal and manual choice also disable comparison. These actions preserve your separately consented enrollment template. To delete it and disable enrollment, use the Face enrollment page. Deleting or withdrawing enrollment also deletes comparison results that refer to that template.\n\nExpired or invalid results are unusable immediately and are physically removed on comparison requests or when the cleanup command runs. This is not a continuously scheduled deletion service. Copies may remain in provider backups under separate retention. Attempt metadata becomes eligible for cleanup after eight days and preserves the five-attempts-per-ten-minutes limit across withdrawals. Choice, comparison and deletion receipts contain metadata without images, features or scores and remain in this development database. You can withdraw here at any time.',true);
CREATE TABLE attendai.verification_choices(
 student_id uuid PRIMARY KEY REFERENCES attendai.students(id),notice_version text NOT NULL REFERENCES attendai.verification_notices(version),
 choice text NOT NULL CHECK(choice IN ('granted','manual','withdrawn')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz,
 CHECK((choice='granted')=(expires_at IS NOT NULL))
);
CREATE TABLE attendai.verification_attempts(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),student_id uuid NOT NULL REFERENCES attendai.students(id),
 notice_version text NOT NULL REFERENCES attendai.verification_notices(version),choice_revision integer NOT NULL CHECK(choice_revision>0),
 reference_template_id uuid NOT NULL,issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 consumed_at timestamptz,completed_at timestamptz,cancelled_at timestamptz
);
CREATE INDEX verification_attempt_student_time ON attendai.verification_attempts(student_id,issued_at);
CREATE TABLE attendai.verification_trials(
 trial_id uuid PRIMARY KEY,student_id uuid NOT NULL REFERENCES attendai.students(id),
 token_hash text NOT NULL UNIQUE REFERENCES attendai.verification_attempts(token_hash),
 notice_version text NOT NULL REFERENCES attendai.verification_notices(version),choice_revision integer NOT NULL,
 reference_template_id uuid NOT NULL REFERENCES attendai.biometric_templates(template_id) ON DELETE CASCADE,
 model_version text NOT NULL CHECK(model_version='sface2021dec-yunet2023mar-v1'),
 similarity double precision NOT NULL CHECK(similarity>=-1 AND similarity<=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL
);
CREATE INDEX verification_trial_student_time ON attendai.verification_trials(student_id,created_at);
CREATE TABLE attendai.verification_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,student_id uuid NOT NULL REFERENCES attendai.students(id),
 event_type text NOT NULL CHECK(event_type IN ('granted','manual','withdrawn','compared','result_deleted')),
 notice_version text NOT NULL REFERENCES attendai.verification_notices(version),choice_revision integer NOT NULL,
 trial_id uuid,actor_id uuid REFERENCES attendai.app_users(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION attendai.current_verification_notice() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT version FROM attendai.verification_notices WHERE is_current $$;
CREATE FUNCTION attendai.verification_allowed(sid uuid,ver text,rev integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM attendai.verification_choices c JOIN attendai.students s ON s.id=c.student_id JOIN attendai.app_users u ON u.id=s.user_id
 WHERE c.student_id=sid AND c.choice='granted' AND c.notice_version=ver AND c.revision=rev AND c.expires_at>clock_timestamp()
 AND ver=attendai.current_verification_notice() AND s.is_active AND u.is_active AND u.role='student' AND u.auth_provider='better-auth') $$;
CREATE FUNCTION attendai.verification_ready(sid uuid,ver text,rev integer,tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT attendai.verification_allowed(sid,ver,rev) AND EXISTS(SELECT 1 FROM attendai.biometric_templates t
 WHERE t.student_id=sid AND t.template_id=tid AND t.expires_at>clock_timestamp() AND attendai.biometric_allowed(sid,t.notice_version,t.choice_revision)) $$;
ALTER TABLE attendai.verification_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.verification_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.verification_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.verification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY verification_notice_read ON attendai.verification_notices FOR SELECT TO attendai_app USING(attendai.actor_role() IS NOT NULL);
CREATE POLICY verification_choice_read ON attendai.verification_choices FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY verification_choice_insert ON attendai.verification_choices FOR INSERT TO attendai_app WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY verification_choice_update ON attendai.verification_choices FOR UPDATE TO attendai_app USING(attendai.own_biometric(student_id)) WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY verification_attempt_all ON attendai.verification_attempts FOR ALL TO attendai_app USING(attendai.own_biometric(student_id)) WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY verification_trial_read ON attendai.verification_trials FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id) AND expires_at>clock_timestamp() AND attendai.verification_ready(student_id,notice_version,choice_revision,reference_template_id));
CREATE POLICY verification_trial_add ON attendai.verification_trials FOR INSERT TO attendai_app WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY verification_trial_delete ON attendai.verification_trials FOR DELETE TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY verification_event_read ON attendai.verification_events FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE FUNCTION attendai.prepare_verification_choice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student link required.'; END IF;
 IF TG_OP='UPDATE' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Choice identity cannot change.'; END IF;
 IF NEW.notice_version IS DISTINCT FROM attendai.current_verification_notice() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison notice changed.'; END IF;
 IF NEW.choice='granted' AND NOT EXISTS(SELECT 1 FROM attendai.biometric_templates t WHERE t.student_id=NEW.student_id AND t.expires_at>clock_timestamp() AND attendai.biometric_allowed(t.student_id,t.notice_version,t.choice_revision)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current enrollment template required.'; END IF;
 NEW.revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
 NEW.decided_at:=clock_timestamp();NEW.expires_at:=CASE WHEN NEW.choice='granted' THEN NEW.decided_at+interval '30 days' ELSE NULL END;RETURN NEW;
END $$;
CREATE FUNCTION attendai.record_verification_choice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 DELETE FROM attendai.verification_trials WHERE student_id=NEW.student_id;
 INSERT INTO attendai.verification_events(student_id,event_type,notice_version,choice_revision,actor_id) VALUES(NEW.student_id,NEW.choice,NEW.notice_version,NEW.revision,attendai.actor_id());RETURN NEW;
END $$;
CREATE TRIGGER verification_choice_prepare BEFORE INSERT OR UPDATE ON attendai.verification_choices FOR EACH ROW EXECUTE FUNCTION attendai.prepare_verification_choice();
CREATE TRIGGER verification_choice_receipt AFTER INSERT OR UPDATE ON attendai.verification_choices FOR EACH ROW EXECUTE FUNCTION attendai.record_verification_choice();
CREATE FUNCTION attendai.prepare_verification_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student link required.'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
  IF NOT attendai.verification_ready(NEW.student_id,NEW.notice_version,NEW.choice_revision,NEW.reference_template_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current comparison grants and template required.'; END IF;
  IF (SELECT count(*) FROM attendai.verification_attempts WHERE student_id=NEW.student_id AND issued_at>clock_timestamp()-interval '10 minutes')>=5 THEN RAISE EXCEPTION 'Comparison attempt limit reached.'; END IF;
  NEW.issued_at:=clock_timestamp();NEW.expires_at:=NEW.issued_at+interval '90 seconds';NEW.consumed_at:=NULL;NEW.completed_at:=NULL;NEW.cancelled_at:=NULL;
 ELSE
  IF ROW(NEW.token_hash,NEW.student_id,NEW.notice_version,NEW.choice_revision,NEW.reference_template_id,NEW.issued_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.token_hash,OLD.student_id,OLD.notice_version,OLD.choice_revision,OLD.reference_template_id,OLD.issued_at,OLD.expires_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison token changed.'; END IF;
  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
   IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison token cancelled.'; END IF;
   NEW.cancelled_at:=clock_timestamp();
  END IF;
  IF NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
   IF OLD.expires_at<=clock_timestamp() OR OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NOT attendai.verification_ready(OLD.student_id,OLD.notice_version,OLD.choice_revision,OLD.reference_template_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison token invalid.'; END IF;
  END IF;
  IF NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
   IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison token already used.'; END IF;
   NEW.consumed_at:=clock_timestamp();
  END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
   IF OLD.consumed_at IS NULL OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison token already completed.'; END IF;
   NEW.completed_at:=clock_timestamp();
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER verification_attempt_prepare BEFORE INSERT OR UPDATE ON attendai.verification_attempts FOR EACH ROW EXECUTE FUNCTION attendai.prepare_verification_attempt();
-- The runtime has no general ciphertext SELECT. This getter is bound to one fresh, consumed own attempt.
CREATE FUNCTION attendai.verification_reference(digest text) RETURNS TABLE(student_id uuid,template_id uuid,notice_version text,choice_revision integer,model_version text,key_id text,iv bytea,ciphertext bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.student_id,t.template_id,t.notice_version,t.choice_revision,t.model_version,t.key_id,t.iv,t.ciphertext
 FROM attendai.verification_attempts a JOIN attendai.biometric_templates t ON t.student_id=a.student_id AND t.template_id=a.reference_template_id
 WHERE a.token_hash=digest AND attendai.own_biometric(a.student_id) AND a.consumed_at IS NOT NULL AND a.completed_at IS NULL AND a.cancelled_at IS NULL
 AND a.expires_at>clock_timestamp() AND attendai.verification_ready(a.student_id,a.notice_version,a.choice_revision,a.reference_template_id) $$;
CREATE FUNCTION attendai.prepare_verification_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) OR NOT attendai.verification_ready(NEW.student_id,NEW.notice_version,NEW.choice_revision,NEW.reference_template_id) OR NOT EXISTS(
 SELECT 1 FROM attendai.verification_attempts a WHERE a.token_hash=NEW.token_hash AND a.student_id=NEW.student_id AND a.notice_version=NEW.notice_version AND a.choice_revision=NEW.choice_revision
 AND a.reference_template_id=NEW.reference_template_id AND a.completed_at IS NOT NULL AND a.cancelled_at IS NULL AND a.expires_at>clock_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Completed own comparison required.'; END IF;
 NEW.created_at:=clock_timestamp();
 SELECT least(NEW.created_at+interval '7 days',c.expires_at,t.expires_at) INTO NEW.expires_at FROM attendai.verification_choices c JOIN attendai.biometric_templates t ON t.student_id=c.student_id WHERE c.student_id=NEW.student_id;
 RETURN NEW;
END $$;
CREATE FUNCTION attendai.record_verification_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO attendai.verification_events(student_id,event_type,notice_version,choice_revision,trial_id,actor_id) VALUES(NEW.student_id,'compared',NEW.notice_version,NEW.choice_revision,NEW.trial_id,attendai.actor_id());RETURN NEW;
 END IF;
 INSERT INTO attendai.verification_events(student_id,event_type,notice_version,choice_revision,trial_id,actor_id) VALUES(OLD.student_id,'result_deleted',OLD.notice_version,OLD.choice_revision,OLD.trial_id,attendai.actor_id());RETURN OLD;
END $$;
CREATE TRIGGER verification_trial_prepare BEFORE INSERT ON attendai.verification_trials FOR EACH ROW EXECUTE FUNCTION attendai.prepare_verification_trial();
CREATE TRIGGER verification_trial_receipt AFTER INSERT OR DELETE ON attendai.verification_trials FOR EACH ROW EXECUTE FUNCTION attendai.record_verification_trial();
CREATE FUNCTION attendai.purge_verification_data() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE n integer;m integer;BEGIN
 DELETE FROM attendai.verification_trials WHERE trial_id IN(SELECT trial_id FROM attendai.verification_trials
 WHERE (attendai.actor_id() IS NULL OR attendai.own_biometric(student_id)) AND (expires_at<=clock_timestamp() OR NOT attendai.verification_ready(student_id,notice_version,choice_revision,reference_template_id)) LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM attendai.verification_attempts WHERE token_hash IN(SELECT token_hash FROM attendai.verification_attempts a
 WHERE issued_at<clock_timestamp()-interval '8 days' AND (attendai.actor_id() IS NULL OR attendai.own_biometric(student_id))
 AND NOT EXISTS(SELECT 1 FROM attendai.verification_trials t WHERE t.token_hash=a.token_hash) LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS m=ROW_COUNT;RETURN n+m;
END $$;
CREATE FUNCTION attendai.invalidate_verification_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF ROW(NEW.version,NEW.purpose,NEW.title,NEW.body,NEW.published_at) IS DISTINCT FROM ROW(OLD.version,OLD.purpose,OLD.title,OLD.body,OLD.published_at) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Publish a new comparison notice version.'; END IF;
 IF OLD.is_current AND NOT NEW.is_current THEN DELETE FROM attendai.verification_trials WHERE notice_version=OLD.version;END IF;RETURN NEW;
END $$;
CREATE TRIGGER verification_notice_preserve BEFORE UPDATE ON attendai.verification_notices FOR EACH ROW EXECUTE FUNCTION attendai.invalidate_verification_notice();
CREATE TRIGGER verification_event_no_change BEFORE UPDATE OR DELETE ON attendai.verification_events FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER verification_event_no_truncate BEFORE TRUNCATE ON attendai.verification_events FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER verification_choice_no_delete BEFORE DELETE ON attendai.verification_choices FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
REVOKE ALL ON attendai.verification_notices,attendai.verification_choices,attendai.verification_attempts,attendai.verification_trials,attendai.verification_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE attendai.verification_events_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION attendai.current_verification_notice(),attendai.verification_allowed(uuid,text,integer),attendai.verification_ready(uuid,text,integer,uuid),attendai.prepare_verification_choice(),attendai.record_verification_choice(),attendai.prepare_verification_attempt(),attendai.verification_reference(text),attendai.prepare_verification_trial(),attendai.record_verification_trial(),attendai.purge_verification_data(),attendai.invalidate_verification_notice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendai.current_verification_notice(),attendai.verification_allowed(uuid,text,integer),attendai.verification_ready(uuid,text,integer,uuid),attendai.verification_reference(text),attendai.purge_verification_data() TO attendai_app;
GRANT SELECT ON attendai.verification_notices,attendai.verification_choices,attendai.verification_attempts,attendai.verification_trials,attendai.verification_events TO attendai_app;
GRANT INSERT(student_id,notice_version,choice),UPDATE(notice_version,choice) ON attendai.verification_choices TO attendai_app;
GRANT INSERT(token_hash,student_id,notice_version,choice_revision,reference_template_id),UPDATE(consumed_at,completed_at,cancelled_at) ON attendai.verification_attempts TO attendai_app;
GRANT INSERT(trial_id,student_id,token_hash,notice_version,choice_revision,reference_template_id,model_version,similarity),DELETE ON attendai.verification_trials TO attendai_app;
INSERT INTO attendai.schema_migrations(version,description) VALUES('006','Separately consented one-to-one comparison trials without attendance decisions');
COMMIT;
