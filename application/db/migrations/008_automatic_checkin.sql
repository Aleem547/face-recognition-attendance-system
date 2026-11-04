-- Experimental automatic check-in. No existing marks, policies, grants or keys
-- are changed. A staff member must opt in each session and supply a policy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='007') THEN RAISE EXCEPTION 'Apply migration 007 first.'; END IF;
 IF EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='008') THEN RAISE EXCEPTION 'Migration 008 already exists.'; END IF;
END $$;

ALTER TABLE attendai.attendance_records DROP CONSTRAINT attendance_records_method_check,
 ADD CONSTRAINT attendance_records_method_check CHECK(method IN ('manual','experimental_face'));
ALTER TABLE attendai.attendance_events DROP CONSTRAINT attendance_events_method_check,
 ADD CONSTRAINT attendance_events_method_check CHECK(method IN ('manual','experimental_face'));
-- A staff correction is a manual action. Earlier automatic provenance stays in
-- revision 1 of the immutable attendance history.
CREATE OR REPLACE FUNCTION attendai.prepare_attendance_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.recorded_at:=clock_timestamp(); NEW.updated_at:=NEW.recorded_at; NEW.revision:=1;
 ELSE
  IF ROW(NEW.id,NEW.session_id,NEW.course_id,NEW.student_id,NEW.recorded_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.session_id,OLD.course_id,OLD.student_id,OLD.recorded_at) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Attendance identity and initial timestamp cannot be changed.';
  END IF;
  NEW.updated_at:=clock_timestamp(); NEW.revision:=OLD.revision+1; NEW.method:='manual';
 END IF; RETURN NEW;
END $$;

CREATE TABLE attendai.face_checkin_policies(
 session_id uuid PRIMARY KEY, course_id uuid NOT NULL,
 enabled boolean NOT NULL, revision integer NOT NULL CHECK(revision>0),
 similarity_min double precision NOT NULL CHECK(similarity_min>0 AND similarity_min<=1),
 pad_min double precision NOT NULL CHECK(pad_min>0 AND pad_min<=1),
 late_after_minutes integer NOT NULL CHECK(late_after_minutes BETWEEN 0 AND 120),
 configured_by uuid NOT NULL REFERENCES attendai.app_users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(session_id,course_id) REFERENCES attendai.sessions(id,course_id)
);
CREATE TABLE attendai.face_checkin_policy_events(
 session_id uuid NOT NULL REFERENCES attendai.sessions(id), revision integer NOT NULL,
 course_id uuid NOT NULL REFERENCES attendai.courses(id), enabled boolean NOT NULL,
 similarity_min double precision NOT NULL, pad_min double precision NOT NULL,
 late_after_minutes integer NOT NULL, configured_by uuid NOT NULL REFERENCES attendai.app_users(id),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(session_id,revision)
);
CREATE TABLE attendai.face_checkin_choices(
 student_id uuid PRIMARY KEY REFERENCES attendai.students(id),
 granted boolean NOT NULL, revision integer NOT NULL CHECK(revision>0),
 notice_version text NOT NULL CHECK(notice_version='automatic-checkin-v1'),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz,
 CHECK(granted=(expires_at IS NOT NULL))
);
CREATE TABLE attendai.face_checkin_choice_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 student_id uuid NOT NULL REFERENCES attendai.students(id), granted boolean NOT NULL,
 revision integer NOT NULL, notice_version text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE attendai.face_checkin_attempts(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 student_id uuid NOT NULL REFERENCES attendai.students(id), session_id uuid NOT NULL REFERENCES attendai.sessions(id),
 policy_revision integer NOT NULL, choice_revision integer NOT NULL, reference_template_id uuid NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '90 seconds'),
 consumed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
 FOREIGN KEY(session_id,policy_revision) REFERENCES attendai.face_checkin_policy_events(session_id,revision)
);
CREATE INDEX face_checkin_attempt_student_time ON attendai.face_checkin_attempts(student_id,issued_at);
CREATE TABLE attendai.face_checkin_receipts(
 receipt_id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE,
 student_id uuid NOT NULL REFERENCES attendai.students(id), session_id uuid NOT NULL REFERENCES attendai.sessions(id),
 policy_revision integer NOT NULL, choice_revision integer NOT NULL,
 notice_version text NOT NULL CHECK(notice_version='automatic-checkin-v1'),
 model_version text NOT NULL CHECK(model_version='sface2021dec-yunet2023mar-v1'),
 decision text NOT NULL CHECK(decision IN ('accepted','identity_below_threshold','pad_below_threshold')),
 attendance_id uuid REFERENCES attendai.attendance_records(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((decision='accepted')=(attendance_id IS NOT NULL)),
 FOREIGN KEY(session_id,policy_revision) REFERENCES attendai.face_checkin_policy_events(session_id,revision)
);
-- No raw images, embeddings or identity/PAD scores are stored in these tables.
ALTER TABLE attendai.face_checkin_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.face_checkin_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.face_checkin_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.face_checkin_choice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.face_checkin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.face_checkin_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkin_policy_read ON attendai.face_checkin_policies FOR SELECT TO attendai_app USING(attendai.read_course(course_id));
CREATE POLICY checkin_policy_event_read ON attendai.face_checkin_policy_events FOR SELECT TO attendai_app USING(attendai.read_course(course_id));
CREATE POLICY checkin_choice_read ON attendai.face_checkin_choices FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY checkin_choice_event_read ON attendai.face_checkin_choice_events FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY checkin_attempt_read ON attendai.face_checkin_attempts FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id));
CREATE POLICY checkin_receipt_read ON attendai.face_checkin_receipts FOR SELECT TO attendai_app USING(attendai.own_biometric(student_id) OR EXISTS(
 SELECT 1 FROM attendai.sessions s WHERE s.id=session_id AND attendai.manage_course(s.course_id)));

CREATE FUNCTION attendai.set_face_checkin_policy(session uuid, expected integer, active boolean,
 identity_cutoff double precision, pad_cutoff double precision, late_minutes integer, acknowledgement text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s attendai.sessions%ROWTYPE; oldrev integer; p attendai.face_checkin_policies%ROWTYPE;
BEGIN
 SELECT * INTO s FROM attendai.sessions WHERE id=session FOR UPDATE;
 IF s.id IS NULL OR NOT attendai.manage_course(s.course_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Session unavailable.'; END IF;
 IF s.state NOT IN ('scheduled','open') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in policy requires a scheduled or open session.'; END IF;
 SELECT revision INTO oldrev FROM attendai.face_checkin_policies WHERE session_id=session FOR UPDATE;
 IF expected IS NULL OR expected<>coalesce(oldrev,0) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in policy changed. Refresh first.'; END IF;
 IF active IS NULL OR (active AND acknowledgement IS DISTINCT FROM 'experimental-policy-v1') OR
  identity_cutoff IS NULL OR NOT(identity_cutoff>0 AND identity_cutoff<=1) OR
  pad_cutoff IS NULL OR NOT(pad_cutoff>0 AND pad_cutoff<=1) OR late_minutes IS NULL OR late_minutes NOT BETWEEN 0 AND 120 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Supply explicit experimental cutoffs and acknowledge their limitations.';
 END IF;
 INSERT INTO attendai.face_checkin_policies AS current_policy(session_id,course_id,enabled,revision,similarity_min,pad_min,late_after_minutes,configured_by)
 VALUES(session,s.course_id,active,coalesce(oldrev,0)+1,identity_cutoff,pad_cutoff,late_minutes,attendai.actor_id())
 ON CONFLICT(session_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=EXCLUDED.revision,
 similarity_min=EXCLUDED.similarity_min,pad_min=EXCLUDED.pad_min,late_after_minutes=EXCLUDED.late_after_minutes,
 configured_by=EXCLUDED.configured_by,updated_at=clock_timestamp() RETURNING * INTO p;
 INSERT INTO attendai.face_checkin_policy_events(session_id,revision,course_id,enabled,similarity_min,pad_min,late_after_minutes,configured_by)
 VALUES(p.session_id,p.revision,p.course_id,p.enabled,p.similarity_min,p.pad_min,p.late_after_minutes,p.configured_by);
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION attendai.choose_face_checkin(active boolean, expected integer, notice text, acknowledgement boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid; oldrev integer; result attendai.face_checkin_choices%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT id INTO sid FROM attendai.students WHERE user_id=attendai.actor_id();
 IF sid IS NULL OR NOT attendai.own_biometric(sid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An active linked student account is required.'; END IF;
 SELECT revision INTO oldrev FROM attendai.face_checkin_choices WHERE student_id=sid FOR UPDATE;
 IF expected IS NULL OR expected<>coalesce(oldrev,0) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in choice changed. Refresh first.'; END IF;
 IF active IS NULL OR notice IS DISTINCT FROM 'automatic-checkin-v1' OR (active AND acknowledgement IS DISTINCT FROM true) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Read the separate automatic check-in notice.';
 END IF;
 IF active AND (NOT EXISTS(SELECT 1 FROM attendai.students WHERE id=sid AND is_active) OR NOT EXISTS(SELECT 1 FROM attendai.biometric_templates t WHERE t.student_id=sid AND t.expires_at>clock_timestamp()
   AND attendai.biometric_allowed(t.student_id,t.notice_version,t.choice_revision))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='A current enrollment template is required.';
 END IF;
 INSERT INTO attendai.face_checkin_choices(student_id,granted,revision,notice_version,expires_at)
 VALUES(sid,active,coalesce(oldrev,0)+1,notice,CASE WHEN active THEN clock_timestamp()+interval '30 days' END)
 ON CONFLICT(student_id) DO UPDATE SET granted=EXCLUDED.granted,revision=EXCLUDED.revision,notice_version=EXCLUDED.notice_version,
 decided_at=clock_timestamp(),expires_at=EXCLUDED.expires_at RETURNING * INTO result;
 UPDATE attendai.face_checkin_attempts SET cancelled_at=clock_timestamp() WHERE student_id=sid AND completed_at IS NULL AND cancelled_at IS NULL;
 INSERT INTO attendai.face_checkin_choice_events(student_id,granted,revision,notice_version) VALUES(sid,active,result.revision,notice);
 RETURN to_jsonb(result);
END $$;

-- This internal helper locks the same session as manual attendance/closure.
-- It is checked at issuance, consumption and commit; callers cannot select a
-- different student or reuse an older policy, consent or reference template.
CREATE FUNCTION attendai.face_checkin_context(session uuid, sid uuid, pr integer, cr integer, template uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s attendai.sessions%ROWTYPE; p attendai.face_checkin_policies%ROWTYPE;
 c attendai.face_checkin_choices%ROWTYPE; t attendai.biometric_templates%ROWTYPE; uid uuid;
BEGIN
 IF NOT attendai.own_biometric(sid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student account required.'; END IF;
 SELECT * INTO s FROM attendai.sessions WHERE id=session FOR UPDATE;
 IF s.id IS NULL OR s.state<>'open' OR clock_timestamp()<s.starts_at OR clock_timestamp()>=s.ends_at THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in unavailable: the class must be open and within its scheduled time.';
 END IF;
 SELECT * INTO p FROM attendai.face_checkin_policies WHERE session_id=session FOR SHARE;
 IF p.session_id IS NULL OR NOT p.enabled OR (pr IS NOT NULL AND p.revision<>pr) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Automatic check-in is disabled or its policy changed.';
 END IF;
 PERFORM 1 FROM attendai.courses WHERE id=s.course_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Active course required.'; END IF;
 SELECT user_id INTO uid FROM attendai.students WHERE id=sid AND is_active AND user_id=attendai.actor_id() FOR SHARE;
 IF uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active own student account required.'; END IF;
 PERFORM 1 FROM attendai.app_users WHERE id=uid AND is_active AND role='student' AND auth_provider='better-auth' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active student account required.'; END IF;
 PERFORM 1 FROM attendai.enrollments WHERE course_id=s.course_id AND student_id=sid AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Active class enrollment required.'; END IF;
 PERFORM 1 FROM attendai.session_roster WHERE session_id=session AND student_id=sid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Frozen class roster membership required.'; END IF;
 IF EXISTS(SELECT 1 FROM attendai.attendance_records WHERE session_id=session AND student_id=sid) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Attendance already exists. Ask staff for a correction.';
 END IF;
 SELECT * INTO c FROM attendai.face_checkin_choices WHERE student_id=sid FOR SHARE;
 SELECT * INTO t FROM attendai.biometric_templates WHERE student_id=sid FOR SHARE;
 IF c.student_id IS NULL OR NOT c.granted OR c.expires_at<=clock_timestamp() OR c.notice_version<>'automatic-checkin-v1'
  OR (cr IS NOT NULL AND cr<>c.revision) OR t.student_id IS NULL OR t.expires_at<=clock_timestamp()
  OR (template IS NOT NULL AND template<>t.template_id) OR NOT attendai.biometric_allowed(sid,t.notice_version,t.choice_revision) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Current automatic check-in consent and enrollment template are required.';
 END IF;
 RETURN jsonb_build_object('studentId',sid,'sessionId',session,'courseId',s.course_id,'policyRevision',p.revision,
 'choiceRevision',c.revision,'templateId',t.template_id,'similarityMin',p.similarity_min,'padMin',p.pad_min,
 'startsAt',s.starts_at,'endsAt',s.ends_at,'lateAfterMinutes',p.late_after_minutes,
 'modelVersion',t.model_version,'noticeVersion',t.notice_version,'templateChoiceRevision',t.choice_revision,
 'keyId',t.key_id,'ciphertext',encode(t.ciphertext,'hex'),'iv',encode(t.iv,'hex'));
END $$;

CREATE FUNCTION attendai.issue_face_checkin(token text, session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid; c jsonb; deadline timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT id INTO sid FROM attendai.students WHERE user_id=attendai.actor_id();
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid check-in token.'; END IF;
 c:=attendai.face_checkin_context(session,sid,NULL,NULL,NULL);
 -- Old token hashes are removed on this student's next request. Minimal
 -- outcome receipts are separate and retain no image/template/score.
 DELETE FROM attendai.face_checkin_attempts WHERE student_id=sid AND issued_at<clock_timestamp()-interval '7 days';
 IF (SELECT count(*) FROM attendai.face_checkin_attempts WHERE student_id=sid AND issued_at>clock_timestamp()-interval '10 minutes')>=5 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Five automatic check-in attempts are allowed per ten minutes.';
 END IF;
 deadline:=least(clock_timestamp()+interval '90 seconds',(c->>'endsAt')::timestamptz);
 INSERT INTO attendai.face_checkin_attempts(token_hash,student_id,session_id,policy_revision,choice_revision,reference_template_id,expires_at)
 VALUES(token,sid,session,(c->>'policyRevision')::integer,(c->>'choiceRevision')::integer,(c->>'templateId')::uuid,deadline);
 RETURN jsonb_build_object('expiresAt',deadline,'sessionId',session);
END $$;
CREATE FUNCTION attendai.consume_face_checkin(token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a attendai.face_checkin_attempts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT * INTO a FROM attendai.face_checkin_attempts WHERE token_hash=token FOR UPDATE;
 IF a.token_hash IS NULL OR NOT attendai.own_biometric(a.student_id) OR a.expires_at<=clock_timestamp() OR
  a.consumed_at IS NOT NULL OR a.completed_at IS NOT NULL OR a.cancelled_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in token expired, was cancelled or was already used.';
 END IF;
 PERFORM attendai.face_checkin_context(a.session_id,a.student_id,a.policy_revision,a.choice_revision,a.reference_template_id);
 UPDATE attendai.face_checkin_attempts SET consumed_at=clock_timestamp() WHERE token_hash=token;
END $$;
CREATE FUNCTION attendai.face_checkin_reference(token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a attendai.face_checkin_attempts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT * INTO a FROM attendai.face_checkin_attempts WHERE token_hash=token FOR UPDATE;
 IF a.token_hash IS NULL OR NOT attendai.own_biometric(a.student_id) OR a.expires_at<=clock_timestamp() OR
  a.consumed_at IS NULL OR a.completed_at IS NOT NULL OR a.cancelled_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in token expired, was cancelled or was already completed.';
 END IF;
 RETURN attendai.face_checkin_context(a.session_id,a.student_id,a.policy_revision,a.choice_revision,a.reference_template_id);
END $$;
CREATE FUNCTION attendai.finish_face_checkin(token text, identity_score double precision,
 pad_one double precision, pad_two double precision, model text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; result text; receipt uuid:=gen_random_uuid(); mark jsonb; status text; marked_at timestamptz;
BEGIN
 c:=attendai.face_checkin_reference(token);
 IF model IS DISTINCT FROM 'sface2021dec-yunet2023mar-v1' OR model IS DISTINCT FROM c->>'modelVersion'
 OR identity_score IS NULL OR NOT(identity_score BETWEEN -1 AND 1)
 OR pad_one IS NULL OR NOT(pad_one BETWEEN 0 AND 1) OR pad_two IS NULL OR NOT(pad_two BETWEEN 0 AND 1) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid server face engine result.';
 END IF;
 result:=CASE WHEN identity_score<(c->>'similarityMin')::double precision THEN 'identity_below_threshold'
   WHEN least(pad_one,pad_two)<(c->>'padMin')::double precision THEN 'pad_below_threshold' ELSE 'accepted' END;
 IF result='accepted' THEN
  -- Recheck time at the actual write. A slow worker cannot mark after expiry.
  marked_at:=clock_timestamp();
  IF marked_at>=(c->>'endsAt')::timestamptz THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='The check-in window has ended.'; END IF;
  status:=CASE WHEN marked_at>=(c->>'startsAt')::timestamptz+make_interval(mins=>(c->>'lateAfterMinutes')::integer) THEN 'late' ELSE 'present' END;
  INSERT INTO attendai.attendance_records(session_id,course_id,student_id,status,method,marked_by,change_reason)
  VALUES((c->>'sessionId')::uuid,(c->>'courseId')::uuid,(c->>'studentId')::uuid,status,'experimental_face',attendai.actor_id(),
   'Experimental automatic face check-in; policy revision '||(c->>'policyRevision')||'; receipt '||receipt::text)
  RETURNING jsonb_build_object('id',id,'status',attendance_records.status,'revision',revision,'updatedAt',updated_at,'method',method) INTO mark;
 END IF;
 INSERT INTO attendai.face_checkin_receipts(receipt_id,token_hash,student_id,session_id,policy_revision,choice_revision,notice_version,model_version,decision,attendance_id)
 VALUES(receipt,token,(c->>'studentId')::uuid,(c->>'sessionId')::uuid,(c->>'policyRevision')::integer,
  (c->>'choiceRevision')::integer,'automatic-checkin-v1',model,result,(mark->>'id')::uuid);
 UPDATE attendai.face_checkin_attempts SET completed_at=clock_timestamp() WHERE token_hash=token;
 RETURN jsonb_build_object('receiptId',receipt,'decision',result,'attendanceChanged',result='accepted',
  'attendance',mark,'experimental',true,'policyRevision',(c->>'policyRevision')::integer);
END $$;

CREATE TRIGGER checkin_policy_history_immutable BEFORE UPDATE OR DELETE ON attendai.face_checkin_policy_events FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER checkin_policy_history_no_truncate BEFORE TRUNCATE ON attendai.face_checkin_policy_events FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER checkin_choice_history_immutable BEFORE UPDATE OR DELETE ON attendai.face_checkin_choice_events FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER checkin_choice_history_no_truncate BEFORE TRUNCATE ON attendai.face_checkin_choice_events FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER checkin_receipt_immutable BEFORE UPDATE OR DELETE ON attendai.face_checkin_receipts FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER checkin_receipt_no_truncate BEFORE TRUNCATE ON attendai.face_checkin_receipts FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
REVOKE ALL ON attendai.face_checkin_policies,attendai.face_checkin_policy_events,attendai.face_checkin_choices,
 attendai.face_checkin_choice_events,attendai.face_checkin_attempts,attendai.face_checkin_receipts FROM PUBLIC;
REVOKE ALL ON SEQUENCE attendai.face_checkin_choice_events_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION attendai.set_face_checkin_policy(uuid,integer,boolean,double precision,double precision,integer,text),
 attendai.choose_face_checkin(boolean,integer,text,boolean),attendai.face_checkin_context(uuid,uuid,integer,integer,uuid),
 attendai.issue_face_checkin(text,uuid),attendai.consume_face_checkin(text),attendai.face_checkin_reference(text),
 attendai.finish_face_checkin(text,double precision,double precision,double precision,text) FROM PUBLIC;
GRANT SELECT ON attendai.face_checkin_policies,attendai.face_checkin_policy_events,attendai.face_checkin_choices,
 attendai.face_checkin_choice_events,attendai.face_checkin_receipts TO attendai_app;
-- Runtime receives no direct DML on check-in state, no method-column write,
-- no direct encrypted-reference SELECT, and no new student attendance policy.
GRANT EXECUTE ON FUNCTION attendai.set_face_checkin_policy(uuid,integer,boolean,double precision,double precision,integer,text),
 attendai.choose_face_checkin(boolean,integer,text,boolean),attendai.issue_face_checkin(text,uuid),
 attendai.consume_face_checkin(text),attendai.face_checkin_reference(text),
 attendai.finish_face_checkin(text,double precision,double precision,double precision,text) TO attendai_app;
INSERT INTO attendai.schema_migrations(version,description) VALUES('008','Explicitly consented experimental automatic face check-in with session policies and atomic audited marks');
COMMIT;
