-- Additive class timing. Existing classes are NOT opted in. No marks are
-- inserted by migration. The server clock acts only on explicitly armed classes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='008') THEN RAISE EXCEPTION 'Apply migration 008 first.'; END IF;
 IF EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='009') THEN RAISE EXCEPTION 'Migration 009 already exists.'; END IF;
END $$;
ALTER TABLE attendai.attendance_records DROP CONSTRAINT attendance_records_method_check,
 ADD CONSTRAINT attendance_records_method_check CHECK(method IN ('manual','experimental_face','automatic_absence'));
ALTER TABLE attendai.attendance_events DROP CONSTRAINT attendance_events_method_check,
 ADD CONSTRAINT attendance_events_method_check CHECK(method IN ('manual','experimental_face','automatic_absence'));
ALTER TABLE attendai.face_checkin_receipts ADD COLUMN arrived_at timestamptz;
ALTER TABLE attendai.face_checkin_choices DROP CONSTRAINT face_checkin_choices_notice_version_check, ADD CONSTRAINT face_checkin_choices_notice_version_check CHECK(notice_version IN ('automatic-checkin-v1','automatic-checkin-v2'));
ALTER TABLE attendai.face_checkin_receipts DROP CONSTRAINT face_checkin_receipts_notice_version_check, ADD CONSTRAINT face_checkin_receipts_notice_version_check CHECK(notice_version IN ('automatic-checkin-v1','automatic-checkin-v2'));

CREATE TABLE attendai.session_automation(
 session_id uuid PRIMARY KEY, course_id uuid NOT NULL, enabled boolean NOT NULL,
 revision integer NOT NULL CHECK(revision>0), configured_by uuid NOT NULL REFERENCES attendai.app_users(id),
 armed_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_tick_at timestamptz,
 opened_at timestamptz, finalized_at timestamptz, review_reason text,
 FOREIGN KEY(session_id,course_id) REFERENCES attendai.sessions(id,course_id)
);
CREATE TABLE attendai.session_automation_roster(
 session_id uuid NOT NULL,course_id uuid NOT NULL,student_id uuid NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(session_id,student_id),
 FOREIGN KEY(session_id,course_id) REFERENCES attendai.sessions(id,course_id),
 FOREIGN KEY(course_id,student_id) REFERENCES attendai.enrollments(course_id,student_id)
);
CREATE TABLE attendai.session_automation_events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES attendai.sessions(id),course_id uuid NOT NULL REFERENCES attendai.courses(id),
 event_type text NOT NULL CHECK(event_type IN ('armed','disabled','opened','finalized','paused')),
 actor_id uuid NOT NULL REFERENCES attendai.app_users(id), reason text NOT NULL,
 absent_count integer NOT NULL DEFAULT 0 CHECK(absent_count>=0),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE attendai.class_clock_state(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_tick_at timestamptz NOT NULL
);
ALTER TABLE attendai.session_automation ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.session_automation_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.session_automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.class_clock_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY automation_read ON attendai.session_automation FOR SELECT TO attendai_app USING(attendai.read_course(course_id));
CREATE POLICY automation_roster_read ON attendai.session_automation_roster FOR SELECT TO attendai_app USING(
 attendai.manage_course(course_id) OR attendai.own_biometric(student_id));
CREATE POLICY automation_event_read ON attendai.session_automation_events FOR SELECT TO attendai_app USING(attendai.manage_course(course_id));
CREATE POLICY clock_state_read ON attendai.class_clock_state FOR SELECT TO attendai_app USING(attendai.actor_role() IS NOT NULL);
CREATE TRIGGER automation_event_immutable BEFORE UPDATE OR DELETE ON attendai.session_automation_events FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER automation_event_no_truncate BEFORE TRUNCATE ON attendai.session_automation_events FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER automation_roster_immutable BEFORE UPDATE OR DELETE ON attendai.session_automation_roster FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER automation_roster_no_truncate BEFORE TRUNCATE ON attendai.session_automation_roster FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();

CREATE FUNCTION attendai.configure_session_automation(session uuid,expected integer,active boolean,acknowledgement text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s attendai.sessions%ROWTYPE;a attendai.session_automation%ROWTYPE;rev integer;reason text;
BEGIN
 SELECT * INTO s FROM attendai.sessions WHERE id=session FOR UPDATE;
 IF s.id IS NULL OR NOT attendai.manage_course(s.course_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Session unavailable.'; END IF;
 IF s.state NOT IN ('scheduled','open') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Only scheduled or open classes can change automatic timing.'; END IF;
 SELECT * INTO a FROM attendai.session_automation WHERE session_id=session FOR UPDATE;
 rev:=coalesce(a.revision,0);
 IF expected IS NULL OR expected<>rev THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Class timing changed. Refresh first.'; END IF;
 IF active IS NULL OR (active AND acknowledgement IS DISTINCT FROM 'class-automation-v1') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Read the automatic class timing acknowledgement.';
 END IF;
 IF active THEN
  IF s.ends_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM attendai.face_checkin_policies WHERE session_id=session AND enabled) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Enable a face policy for a class whose end time is still ahead.';
  END IF;
  -- Freeze once when timing is armed, so an outage cannot fabricate a start-time
  -- roster from later membership. Re-enabling never rewrites this snapshot.
  IF NOT EXISTS(SELECT 1 FROM attendai.session_automation_roster WHERE session_id=session) THEN
   PERFORM 1 FROM attendai.courses WHERE id=s.course_id AND is_active FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Active course required.'; END IF;
   IF s.state='open' THEN
    INSERT INTO attendai.session_automation_roster(session_id,course_id,student_id)
     SELECT session_id,course_id,student_id FROM attendai.session_roster WHERE session_id=session;
   ELSE
    INSERT INTO attendai.session_automation_roster(session_id,course_id,student_id)
     SELECT session,s.course_id,e.student_id FROM attendai.enrollments e JOIN attendai.students st ON st.id=e.student_id
      WHERE e.course_id=s.course_id AND e.is_active AND st.is_active;
   END IF;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Enroll students before arming automatic class timing.'; END IF;
  END IF;
 END IF;
 reason:=coalesce(a.review_reason,CASE WHEN active AND clock_timestamp()>s.starts_at+interval '90 seconds' THEN 'armed_after_start' END);
 INSERT INTO attendai.session_automation(session_id,course_id,enabled,revision,configured_by,last_tick_at,review_reason)
 VALUES(session,s.course_id,active,rev+1,attendai.actor_id(),clock_timestamp(),reason)
 ON CONFLICT(session_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=EXCLUDED.revision,
 configured_by=EXCLUDED.configured_by,last_tick_at=EXCLUDED.last_tick_at,review_reason=EXCLUDED.review_reason RETURNING * INTO a;
 INSERT INTO attendai.session_automation_events(session_id,course_id,event_type,actor_id,reason)
 VALUES(session,s.course_id,CASE WHEN active THEN 'armed' ELSE 'disabled' END,attendai.actor_id(),
 CASE WHEN active THEN 'Staff enabled class timing; the class roster is now fixed.' ELSE 'Staff disabled class timing; existing records were preserved.' END);
 RETURN to_jsonb(a);
END $$;

CREATE OR REPLACE FUNCTION attendai.guard_session_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'scheduled' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New sessions must be scheduled.'; END IF;
  PERFORM 1 FROM attendai.courses WHERE id=NEW.course_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Use an active course.'; END IF; RETURN NEW;
 END IF;
 IF NEW.state=OLD.state THEN RETURN NEW; END IF;
 IF OLD.state='scheduled' AND NEW.state='open' THEN
  PERFORM 1 FROM attendai.courses WHERE id=NEW.course_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Use an active course.'; END IF;
  IF EXISTS(SELECT 1 FROM attendai.session_automation WHERE session_id=NEW.id AND enabled) THEN
   INSERT INTO attendai.session_roster(session_id,course_id,student_id)
    SELECT session_id,course_id,student_id FROM attendai.session_automation_roster WHERE session_id=NEW.id;
  ELSE
   INSERT INTO attendai.session_roster(session_id,course_id,student_id)
    SELECT NEW.id,NEW.course_id,e.student_id FROM attendai.enrollments e JOIN attendai.students s ON s.id=e.student_id
    WHERE e.course_id=NEW.course_id AND e.is_active AND s.is_active;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enroll at least one active student before opening attendance.'; END IF;
 ELSIF OLD.state='open' AND NEW.state='closed' THEN
  IF EXISTS(SELECT 1 FROM attendai.session_roster r WHERE r.session_id=NEW.id AND NOT EXISTS(
   SELECT 1 FROM attendai.attendance_records a WHERE a.session_id=r.session_id AND a.student_id=r.student_id)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Record a status for every student before closing attendance.';
  END IF;
 ELSIF OLD.state='scheduled' AND NEW.state='cancelled' THEN NULL;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This session state transition is not allowed.'; END IF; RETURN NEW;
END $$;

-- Only the trusted server clock calls this outside an end-user transaction.
-- There is no public tick URL and no caller-supplied clock/time/student input.
CREATE FUNCTION attendai.tick_session_automation() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job record;at_time timestamptz;problem text;opened integer:=0;closed integer:=0;absent integer:=0;added integer;prior_tick timestamptz;
BEGIN
 IF attendai.actor_id() IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='The class clock is a server-only operation.'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('attendai:class-clock',0)) THEN RETURN jsonb_build_object('busy',true); END IF;
 SELECT last_tick_at INTO prior_tick FROM attendai.class_clock_state WHERE singleton;
 INSERT INTO attendai.class_clock_state(singleton,last_tick_at) VALUES(true,clock_timestamp())
 ON CONFLICT(singleton) DO UPDATE SET last_tick_at=EXCLUDED.last_tick_at;
 FOR job IN SELECT a.*,s.state,s.starts_at,s.ends_at FROM attendai.session_automation a JOIN attendai.sessions s ON s.id=a.session_id
  WHERE a.enabled AND s.state IN ('scheduled','open') ORDER BY CASE WHEN s.state='scheduled' AND s.starts_at<=clock_timestamp() THEN 0 WHEN s.state='open' AND s.ends_at+interval '30 seconds'<=clock_timestamp() THEN 1 ELSE 2 END,a.last_tick_at NULLS FIRST,s.starts_at,s.id
  LIMIT 25 FOR UPDATE OF s,a SKIP LOCKED LOOP
  BEGIN
   at_time:=clock_timestamp();problem:=job.review_reason;
   IF at_time<job.starts_at THEN UPDATE attendai.session_automation SET last_tick_at=at_time WHERE session_id=job.session_id;CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM attendai.courses WHERE id=job.course_id AND is_active) OR NOT EXISTS(
    SELECT 1 FROM attendai.app_users u JOIN attendai.courses c ON c.id=job.course_id WHERE u.id=job.configured_by
     AND u.is_active AND u.auth_provider='better-auth' AND (u.role='admin' OR(u.role='teacher' AND c.teacher_id=u.id))) THEN
    problem:=coalesce(problem,'class_or_staff_unavailable');
   ELSIF NOT EXISTS(SELECT 1 FROM attendai.face_checkin_policies WHERE session_id=job.session_id AND enabled) THEN
    problem:=coalesce(problem,'face_policy_disabled');
   ELSIF least(at_time,job.ends_at)-greatest(coalesce(prior_tick,job.last_tick_at,job.armed_at),job.starts_at)>interval '90 seconds' THEN
    problem:=coalesce(problem,'clock_gap');
   END IF;
   IF job.state='scheduled' THEN
    IF at_time>=job.ends_at THEN problem:=coalesce(problem,'missed_class_window');
    ELSIF problem IS NULL THEN
     UPDATE attendai.sessions SET state='open' WHERE id=job.session_id;
     UPDATE attendai.session_automation SET opened_at=at_time WHERE session_id=job.session_id;
     INSERT INTO attendai.session_automation_events(session_id,course_id,event_type,actor_id,reason)
      VALUES(job.session_id,job.course_id,'opened',job.configured_by,'Class clock opened the scheduled attendance window.');
     opened:=opened+1;job.state:='open';
    END IF;
   END IF;
   IF problem IS DISTINCT FROM job.review_reason AND problem IS NOT NULL THEN
    INSERT INTO attendai.session_automation_events(session_id,course_id,event_type,actor_id,reason)
     VALUES(job.session_id,job.course_id,'paused',job.configured_by,problem);
   END IF;
   UPDATE attendai.session_automation SET review_reason=problem,last_tick_at=at_time WHERE session_id=job.session_id;
   -- A bounded 30-second processing allowance lets a face upload admitted
   -- before class end finish. New arrivals cannot begin after class end.
   IF job.state='open' AND at_time>=job.ends_at+interval '30 seconds' AND problem IS NULL THEN
    INSERT INTO attendai.attendance_records(session_id,course_id,student_id,status,method,marked_by,change_reason)
     SELECT job.session_id,job.course_id,r.student_id,'absent','automatic_absence',job.configured_by,
      'Automatic absence: no saved attendance by the class end and processing allowance. Staff may correct this record with a reason.'
     FROM attendai.session_roster r WHERE r.session_id=job.session_id AND NOT EXISTS(
      SELECT 1 FROM attendai.attendance_records a WHERE a.session_id=r.session_id AND a.student_id=r.student_id);
    GET DIAGNOSTICS added=ROW_COUNT;
    UPDATE attendai.sessions SET state='closed' WHERE id=job.session_id;
    UPDATE attendai.session_automation SET finalized_at=at_time WHERE session_id=job.session_id;
    INSERT INTO attendai.session_automation_events(session_id,course_id,event_type,actor_id,reason,absent_count)
     VALUES(job.session_id,job.course_id,'finalized',job.configured_by,'Class clock filled only unmarked roster entries as Absent and closed the register.',added);
    closed:=closed+1;absent:=absent+added;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   UPDATE attendai.session_automation SET review_reason=coalesce(review_reason,'clock_processing_failed'),last_tick_at=clock_timestamp() WHERE session_id=job.session_id;
   INSERT INTO attendai.session_automation_events(session_id,course_id,event_type,actor_id,reason)
    VALUES(job.session_id,job.course_id,'paused',job.configured_by,'clock_processing_failed');
  END;
 END LOOP;
 RETURN jsonb_build_object('busy',false,'opened',opened,'closed',closed,'absent',absent,'moreDue',EXISTS(SELECT 1 FROM attendai.session_automation a JOIN attendai.sessions s ON s.id=a.session_id WHERE a.enabled AND a.review_reason IS NULL AND ((s.state='scheduled' AND s.starts_at<=clock_timestamp()) OR(s.state='open' AND s.ends_at+interval '30 seconds'<=clock_timestamp()))));
END $$;
REVOKE ALL ON attendai.session_automation,attendai.session_automation_roster,attendai.session_automation_events,attendai.class_clock_state FROM PUBLIC;
REVOKE ALL ON SEQUENCE attendai.session_automation_events_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION attendai.configure_session_automation(uuid,integer,boolean,text),attendai.tick_session_automation() FROM PUBLIC;
GRANT SELECT ON attendai.session_automation,attendai.session_automation_roster,attendai.session_automation_events,attendai.class_clock_state TO attendai_app;
GRANT EXECUTE ON FUNCTION attendai.configure_session_automation(uuid,integer,boolean,text),attendai.tick_session_automation() TO attendai_app;
CREATE OR REPLACE FUNCTION attendai.face_checkin_context(session uuid, sid uuid, pr integer, cr integer, template uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s attendai.sessions%ROWTYPE; p attendai.face_checkin_policies%ROWTYPE;
 c attendai.face_checkin_choices%ROWTYPE; t attendai.biometric_templates%ROWTYPE; uid uuid;
BEGIN
 IF NOT attendai.own_biometric(sid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own student account required.'; END IF;
 SELECT * INTO s FROM attendai.sessions WHERE id=session FOR UPDATE;
 IF s.id IS NULL OR s.state<>'open' OR clock_timestamp()<s.starts_at OR (clock_timestamp()>=s.ends_at AND NOT(
   clock_timestamp()<s.ends_at+interval '30 seconds' AND pr IS NOT NULL AND cr IS NOT NULL AND template IS NOT NULL AND EXISTS(
    SELECT 1 FROM attendai.face_checkin_attempts a WHERE a.session_id=session AND a.student_id=sid AND a.policy_revision=pr
     AND a.choice_revision=cr AND a.reference_template_id=template AND a.consumed_at>=s.starts_at AND a.consumed_at<s.ends_at
     AND a.completed_at IS NULL AND a.cancelled_at IS NULL AND a.expires_at>clock_timestamp()))) THEN
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
 IF c.student_id IS NULL OR NOT c.granted OR c.expires_at<=clock_timestamp() OR c.notice_version<>'automatic-checkin-v2'
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

CREATE OR REPLACE FUNCTION attendai.issue_face_checkin(token text, session uuid) RETURNS jsonb
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
 deadline:=least(clock_timestamp()+interval '90 seconds',(c->>'endsAt')::timestamptz+interval '30 seconds');
 INSERT INTO attendai.face_checkin_attempts(token_hash,student_id,session_id,policy_revision,choice_revision,reference_template_id,expires_at)
 VALUES(token,sid,session,(c->>'policyRevision')::integer,(c->>'choiceRevision')::integer,(c->>'templateId')::uuid,deadline);
 RETURN jsonb_build_object('expiresAt',deadline,'sessionId',session);
END $$;

CREATE OR REPLACE FUNCTION attendai.consume_face_checkin(token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a attendai.face_checkin_attempts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT * INTO a FROM attendai.face_checkin_attempts WHERE token_hash=token FOR UPDATE;
 IF a.token_hash IS NULL OR NOT attendai.own_biometric(a.student_id) OR a.expires_at<=clock_timestamp() OR
  a.consumed_at IS NOT NULL OR a.completed_at IS NOT NULL OR a.cancelled_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in token expired, was cancelled or was already used.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM attendai.sessions WHERE id=a.session_id AND clock_timestamp()>=starts_at AND clock_timestamp()<ends_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='New check-ins require the class time window.'; END IF;
 PERFORM attendai.face_checkin_context(a.session_id,a.student_id,a.policy_revision,a.choice_revision,a.reference_template_id);
 UPDATE attendai.face_checkin_attempts SET consumed_at=clock_timestamp() WHERE token_hash=token;
END $$;

CREATE OR REPLACE FUNCTION attendai.finish_face_checkin(token text, identity_score double precision,
 pad_one double precision, pad_two double precision, model text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; result text; receipt uuid:=gen_random_uuid(); mark jsonb; status text; marked_at timestamptz;arrived timestamptz;
BEGIN
 c:=attendai.face_checkin_reference(token);
 SELECT consumed_at INTO arrived FROM attendai.face_checkin_attempts WHERE token_hash=token;
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
  IF marked_at>=(c->>'endsAt')::timestamptz+interval '30 seconds' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='The check-in window has ended.'; END IF;
  status:=CASE WHEN arrived>=(c->>'startsAt')::timestamptz+make_interval(mins=>(c->>'lateAfterMinutes')::integer) THEN 'late' ELSE 'present' END;
  INSERT INTO attendai.attendance_records(session_id,course_id,student_id,status,method,marked_by,change_reason)
  VALUES((c->>'sessionId')::uuid,(c->>'courseId')::uuid,(c->>'studentId')::uuid,status,'experimental_face',attendai.actor_id(),
   'Experimental automatic face check-in; policy revision '||(c->>'policyRevision')||'; receipt '||receipt::text)
  RETURNING jsonb_build_object('id',id,'status',attendance_records.status,'revision',revision,'updatedAt',updated_at,'method',method) INTO mark;
 END IF;
 INSERT INTO attendai.face_checkin_receipts(receipt_id,token_hash,student_id,session_id,policy_revision,choice_revision,notice_version,model_version,decision,attendance_id,arrived_at)
 VALUES(receipt,token,(c->>'studentId')::uuid,(c->>'sessionId')::uuid,(c->>'policyRevision')::integer,
  (c->>'choiceRevision')::integer,'automatic-checkin-v2',model,result,(mark->>'id')::uuid,arrived);
 UPDATE attendai.face_checkin_attempts SET completed_at=clock_timestamp() WHERE token_hash=token;
 RETURN jsonb_build_object('receiptId',receipt,'decision',result,'attendanceChanged',result='accepted',
  'attendance',mark,'arrivedAt',arrived,'experimental',true,'policyRevision',(c->>'policyRevision')::integer);
END $$;
CREATE OR REPLACE FUNCTION attendai.choose_face_checkin(active boolean, expected integer, notice text, acknowledgement boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid; oldrev integer; result attendai.face_checkin_choices%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('biometric:'||attendai.actor_id()::text,0));
 SELECT id INTO sid FROM attendai.students WHERE user_id=attendai.actor_id();
 IF sid IS NULL OR NOT attendai.own_biometric(sid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An active linked student account is required.'; END IF;
 SELECT revision INTO oldrev FROM attendai.face_checkin_choices WHERE student_id=sid FOR UPDATE;
 IF expected IS NULL OR expected<>coalesce(oldrev,0) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Check-in choice changed. Refresh first.'; END IF;
 IF active IS NULL OR notice IS DISTINCT FROM 'automatic-checkin-v2' OR (active AND acknowledgement IS DISTINCT FROM true) THEN
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
INSERT INTO attendai.schema_migrations(version,description) VALUES('009','Opt-in class clock, automatic absence, frozen automation rosters and arrival-time lateness');
COMMIT;
