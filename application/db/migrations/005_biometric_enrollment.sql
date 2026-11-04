-- Apply with scripts/configure-biometric.mjs, as owner, on DEVELOPMENT after 004.
-- This migration does not enroll anybody or change attendance.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='004') THEN RAISE EXCEPTION 'Apply migration 004 first.'; END IF;
  IF EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='005') THEN RAISE EXCEPTION 'Migration 005 already exists.'; END IF;
END $$;
CREATE TABLE attendai.biometric_notices(
  version text PRIMARY KEY, purpose text NOT NULL CHECK(purpose='face_template_enrollment'),
  title text NOT NULL, body text NOT NULL, is_current boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE UNIQUE INDEX biometric_one_notice ON attendai.biometric_notices(is_current) WHERE is_current;
INSERT INTO attendai.biometric_notices(version,purpose,title,body,is_current) VALUES
('face-enrollment-2026-10-23','face_template_enrollment','Optional face template enrollment',
E'You may choose this experimental enrollment for your own linked student account. Manual attendance remains available on equal terms. The separate local-preview choice does not authorize enrollment. Granting this choice does not start the camera or upload an image.\n\nAfter granting, you must explicitly start the camera and click Capture and enroll. That action sends one JPEG frame to this Face Recognition Attendance System server. A local CPU process checks for one sufficiently clear face and derives a numerical template. The application does not save the frame to files or the database. Processing uses temporary memory, and the process exits afterward. Do not use another person\u2019s image.\n\nThe database stores an AES-256-GCM encrypted template, model version, key identifier, consent revision, and server timestamps. The encryption key stays in the server environment outside the database. Server operators with that key and database access could decrypt templates. Your browser and staff interfaces cannot retrieve the template through this feature.\n\nYour grant and template expire after 30 days. Withdrawal, choosing manual, or Delete my template removes the active stored template and cancels pending enrollment tokens. Withdrawal also disables enrollment. Expired or invalid templates are unusable immediately and are physically removed on biometric requests or when the cleanup command runs. This is not a continuously scheduled deletion service. Encrypted copies may remain in database backups according to the provider\u2019s retention.\n\nChoice and deletion receipts contain metadata without images or templates and remain in this development database. This prototype has no liveness or spoof-resistance guarantee, does not establish identity from a student account link, and does not mark attendance. Matching and accuracy evaluation are later work. Use only your own face voluntarily in a controlled research trial. You can withdraw here at any time.',true);
CREATE TABLE attendai.biometric_choices(
  student_id uuid PRIMARY KEY REFERENCES attendai.students(id) ON DELETE RESTRICT,
  notice_version text NOT NULL REFERENCES attendai.biometric_notices(version),
  choice text NOT NULL CHECK(choice IN ('granted','manual','withdrawn')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  decided_at timestamptz NOT NULL DEFAULT current_timestamp, expires_at timestamptz,
  CHECK((choice='granted')=(expires_at IS NOT NULL))
);
CREATE TABLE attendai.biometric_challenges(
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  student_id uuid NOT NULL REFERENCES attendai.students(id),
  notice_version text NOT NULL REFERENCES attendai.biometric_notices(version),
  choice_revision integer NOT NULL CHECK(choice_revision>0),
  issued_at timestamptz NOT NULL DEFAULT current_timestamp,
  expires_at timestamptz NOT NULL DEFAULT (current_timestamp+interval '90 seconds'),
  consumed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz
);
CREATE INDEX biometric_challenge_student_time ON attendai.biometric_challenges(student_id,issued_at);
CREATE TABLE attendai.biometric_templates(
  student_id uuid PRIMARY KEY REFERENCES attendai.students(id),
  template_id uuid NOT NULL UNIQUE,
  notice_version text NOT NULL REFERENCES attendai.biometric_notices(version),
  choice_revision integer NOT NULL,
  model_version text NOT NULL CHECK(model_version='sface2021dec-yunet2023mar-v1'),
  key_id text NOT NULL CHECK(key_id ~ '^[a-f0-9]{16}$'),
  iv bytea NOT NULL CHECK(octet_length(iv)=12),
  ciphertext bytea NOT NULL CHECK(octet_length(ciphertext)=528),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  expires_at timestamptz NOT NULL
);
CREATE TABLE attendai.biometric_events(
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES attendai.students(id),
  event_type text NOT NULL CHECK(event_type IN ('granted','manual','withdrawn','enrolled','template_deleted')),
  notice_version text NOT NULL REFERENCES attendai.biometric_notices(version),
  choice_revision integer NOT NULL,
  template_id uuid,
  actor_id uuid REFERENCES attendai.app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION attendai.own_biometric(sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$ SELECT coalesce(attendai.actor_role()='student' AND EXISTS
 (SELECT 1 FROM attendai.students WHERE id=sid AND user_id=attendai.actor_id()),false) $$;
CREATE FUNCTION attendai.current_biometric_notice() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$ SELECT version FROM attendai.biometric_notices WHERE is_current $$;
CREATE FUNCTION attendai.biometric_allowed(sid uuid,ver text,rev integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM attendai.biometric_choices c
 JOIN attendai.students s ON s.id=c.student_id JOIN attendai.app_users u ON u.id=s.user_id
 WHERE c.student_id=sid AND c.choice='granted' AND c.notice_version=ver AND c.revision=rev
 AND c.expires_at>clock_timestamp() AND ver=attendai.current_biometric_notice()
 AND s.is_active AND u.is_active AND u.role='student' AND u.auth_provider='better-auth') $$;
ALTER TABLE attendai.biometric_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.biometric_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.biometric_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.biometric_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.biometric_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY biometric_notice_read ON attendai.biometric_notices FOR SELECT TO attendai_app USING(attendai.actor_role() IS NOT NULL);
CREATE POLICY biometric_choice_read ON attendai.biometric_choices FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY biometric_choice_insert ON attendai.biometric_choices FOR INSERT TO attendai_app WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY biometric_choice_update ON attendai.biometric_choices FOR UPDATE TO attendai_app USING(attendai.own_biometric(student_id)) WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY biometric_challenge_all ON attendai.biometric_challenges FOR ALL TO attendai_app USING(attendai.own_biometric(student_id)) WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY biometric_template_read ON attendai.biometric_templates FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY biometric_template_add ON attendai.biometric_templates FOR INSERT TO attendai_app WITH CHECK(attendai.own_biometric(student_id));
CREATE POLICY biometric_template_delete ON attendai.biometric_templates FOR DELETE TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY biometric_event_read ON attendai.biometric_events FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE FUNCTION attendai.prepare_biometric_choice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student link required.'; END IF;
 IF TG_OP='UPDATE' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Choice identity cannot change.'; END IF;
 IF NEW.notice_version IS DISTINCT FROM attendai.current_biometric_notice() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Biometric notice changed.'; END IF;
 IF NEW.choice='granted' AND NOT EXISTS(SELECT 1 FROM attendai.students WHERE id=NEW.student_id AND is_active) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active student required.'; END IF;
 NEW.revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
 NEW.decided_at:=clock_timestamp();
 NEW.expires_at:=CASE WHEN NEW.choice='granted' THEN NEW.decided_at+interval '30 days' ELSE NULL END;
 RETURN NEW;
END $$;
CREATE FUNCTION attendai.record_biometric_choice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 DELETE FROM attendai.biometric_templates WHERE student_id=NEW.student_id;
 -- Older revision tokens become unusable but remain for the attempt limit.
 INSERT INTO attendai.biometric_events(student_id,event_type,notice_version,choice_revision,actor_id)
 VALUES(NEW.student_id,NEW.choice,NEW.notice_version,NEW.revision,attendai.actor_id());
 RETURN NEW;
END $$;
CREATE TRIGGER biometric_choice_prepare BEFORE INSERT OR UPDATE ON attendai.biometric_choices FOR EACH ROW EXECUTE FUNCTION attendai.prepare_biometric_choice();
CREATE TRIGGER biometric_choice_receipt AFTER INSERT OR UPDATE ON attendai.biometric_choices FOR EACH ROW EXECUTE FUNCTION attendai.record_biometric_choice();
CREATE FUNCTION attendai.prepare_biometric_challenge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student link required.'; END IF;
 IF (TG_OP='INSERT' OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at)
  AND NOT attendai.biometric_allowed(NEW.student_id,NEW.notice_version,NEW.choice_revision) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current biometric grant required.'; END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM attendai.biometric_templates WHERE student_id=NEW.student_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Delete the existing template first.'; END IF;
  IF (SELECT count(*) FROM attendai.biometric_challenges WHERE student_id=NEW.student_id AND issued_at>clock_timestamp()-interval '10 minutes')>=5 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Biometric attempt limit reached.'; END IF;
  NEW.issued_at:=clock_timestamp(); NEW.expires_at:=NEW.issued_at+interval '90 seconds'; NEW.consumed_at:=NULL; NEW.completed_at:=NULL; NEW.cancelled_at:=NULL;
 ELSE
  IF ROW(NEW.token_hash,NEW.student_id,NEW.notice_version,NEW.choice_revision,NEW.issued_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.token_hash,OLD.student_id,OLD.notice_version,OLD.choice_revision,OLD.issued_at,OLD.expires_at)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrollment token changed.'; END IF;
  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
   IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrollment token cancelled.'; END IF;
   NEW.cancelled_at:=clock_timestamp();
  END IF;
  IF (NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.completed_at IS DISTINCT FROM OLD.completed_at)
   AND (OLD.expires_at<=clock_timestamp() OR OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrollment token expired or cancelled.'; END IF;
  IF NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
   IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrollment token already used.'; END IF;
   NEW.consumed_at:=clock_timestamp();
  END IF;
  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
   IF OLD.consumed_at IS NULL OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrollment token already completed.'; END IF;
   NEW.completed_at:=clock_timestamp();
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER biometric_challenge_prepare BEFORE INSERT OR UPDATE ON attendai.biometric_challenges FOR EACH ROW EXECUTE FUNCTION attendai.prepare_biometric_challenge();
CREATE FUNCTION attendai.prepare_biometric_template() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT attendai.own_biometric(NEW.student_id) OR NOT attendai.biometric_allowed(NEW.student_id,NEW.notice_version,NEW.choice_revision) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current biometric grant required.'; END IF;
 NEW.created_at:=clock_timestamp();
 SELECT expires_at INTO NEW.expires_at FROM attendai.biometric_choices WHERE student_id=NEW.student_id;
 RETURN NEW;
END $$;
CREATE FUNCTION attendai.record_biometric_template() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO attendai.biometric_events(student_id,event_type,notice_version,choice_revision,template_id,actor_id)
  VALUES(NEW.student_id,'enrolled',NEW.notice_version,NEW.choice_revision,NEW.template_id,attendai.actor_id()); RETURN NEW;
 END IF;
 INSERT INTO attendai.biometric_events(student_id,event_type,notice_version,choice_revision,template_id,actor_id)
 VALUES(OLD.student_id,'template_deleted',OLD.notice_version,OLD.choice_revision,OLD.template_id,attendai.actor_id()); RETURN OLD;
END $$;
CREATE TRIGGER biometric_template_prepare BEFORE INSERT ON attendai.biometric_templates FOR EACH ROW EXECUTE FUNCTION attendai.prepare_biometric_template();
CREATE TRIGGER biometric_template_receipt AFTER INSERT OR DELETE ON attendai.biometric_templates FOR EACH ROW EXECUTE FUNCTION attendai.record_biometric_template();
CREATE FUNCTION attendai.purge_biometric_data() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE removed integer; BEGIN
 DELETE FROM attendai.biometric_templates WHERE student_id IN (SELECT student_id FROM attendai.biometric_templates
 WHERE (attendai.actor_id() IS NULL OR attendai.own_biometric(student_id))
 AND (expires_at<=clock_timestamp() OR NOT attendai.biometric_allowed(student_id,notice_version,choice_revision))
 ORDER BY student_id LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed=ROW_COUNT;
 -- Keep spent tokens long enough to enforce the rolling attempt limit.
 DELETE FROM attendai.biometric_challenges WHERE token_hash IN (SELECT token_hash FROM attendai.biometric_challenges
 WHERE issued_at<clock_timestamp()-interval '1 day' AND (attendai.actor_id() IS NULL OR attendai.own_biometric(student_id)) LIMIT 500 FOR UPDATE SKIP LOCKED);
 RETURN removed;
END $$;
CREATE FUNCTION attendai.invalidate_biometric_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.version IS DISTINCT FROM OLD.version OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Publish a new biometric notice version.'; END IF;
 IF OLD.is_current AND NOT NEW.is_current THEN
  DELETE FROM attendai.biometric_templates WHERE notice_version=OLD.version;
  -- Notice validity also invalidates retained attempt tokens immediately.
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER biometric_notice_preserve BEFORE UPDATE ON attendai.biometric_notices FOR EACH ROW EXECUTE FUNCTION attendai.invalidate_biometric_notice();
CREATE TRIGGER biometric_event_no_change BEFORE UPDATE OR DELETE ON attendai.biometric_events FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER biometric_event_no_truncate BEFORE TRUNCATE ON attendai.biometric_events FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER biometric_choice_no_delete BEFORE DELETE ON attendai.biometric_choices FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
REVOKE ALL ON attendai.biometric_notices,attendai.biometric_choices,attendai.biometric_challenges,attendai.biometric_templates,attendai.biometric_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE attendai.biometric_events_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION attendai.own_biometric(uuid),attendai.current_biometric_notice(),attendai.biometric_allowed(uuid,text,integer),attendai.prepare_biometric_choice(),attendai.record_biometric_choice(),attendai.prepare_biometric_challenge(),attendai.prepare_biometric_template(),attendai.record_biometric_template(),attendai.purge_biometric_data(),attendai.invalidate_biometric_notice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendai.own_biometric(uuid),attendai.current_biometric_notice(),attendai.biometric_allowed(uuid,text,integer),attendai.purge_biometric_data() TO attendai_app;
GRANT SELECT ON attendai.biometric_notices,attendai.biometric_choices,attendai.biometric_challenges,attendai.biometric_events TO attendai_app;
GRANT SELECT(student_id,template_id,notice_version,choice_revision,model_version,key_id,created_at,expires_at) ON attendai.biometric_templates TO attendai_app;
GRANT INSERT(student_id,notice_version,choice),UPDATE(notice_version,choice) ON attendai.biometric_choices TO attendai_app;
GRANT INSERT(token_hash,student_id,notice_version,choice_revision),UPDATE(consumed_at,completed_at,cancelled_at) ON attendai.biometric_challenges TO attendai_app;
GRANT INSERT(student_id,template_id,notice_version,choice_revision,model_version,key_id,iv,ciphertext),DELETE ON attendai.biometric_templates TO attendai_app;
INSERT INTO attendai.schema_migrations(version,description) VALUES('005','Separate biometric consent and encrypted account-linked enrollment');
COMMIT;
