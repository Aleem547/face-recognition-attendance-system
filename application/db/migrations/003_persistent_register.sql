-- Face Recognition Attendance System migration 003. Run ONCE as owner on DEVELOPMENT, after 002.
-- No accounts, demo records, credentials, or biometric information are added.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '002') THEN
    RAISE EXCEPTION 'Apply migration 002 first.';
  END IF;
  IF EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '003') THEN
    RAISE EXCEPTION 'Migration 003 is already recorded. Do not rerun or drop objects.';
  END IF;
  IF EXISTS (SELECT 1 FROM attendai.attendance_records)
     OR EXISTS (SELECT 1 FROM attendai.sessions WHERE state <> 'scheduled') THEN
    RAISE EXCEPTION 'Existing live registers need an explicit roster import before migration 003.';
  END IF;
END;
$guard$;

-- This identity is set transaction-locally by the trusted Next.js backend,
-- ONLY after verifying the Better Auth session. It is never a browser input.
-- Runtime credentials remain private: direct SQL access could set this context.
CREATE FUNCTION attendai.actor_id() RETURNS uuid LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('attendai.actor_id', true), '')::uuid $$;
CREATE FUNCTION attendai.actor_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT role FROM attendai.app_users WHERE id = attendai.actor_id()
      AND is_active AND auth_provider = 'better-auth' $$;
CREATE FUNCTION attendai.manage_course(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT coalesce(attendai.actor_role() = 'admin' OR
      (attendai.actor_role() = 'teacher' AND EXISTS
        (SELECT 1 FROM attendai.courses WHERE id = cid AND teacher_id = attendai.actor_id())), false) $$;
CREATE FUNCTION attendai.read_course(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT attendai.manage_course(cid) OR (attendai.actor_role() = 'student' AND EXISTS
      (SELECT 1 FROM attendai.enrollments e JOIN attendai.students s ON s.id = e.student_id
       WHERE e.course_id = cid AND s.user_id = attendai.actor_id())) $$;
CREATE FUNCTION attendai.read_student(sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT coalesce(attendai.actor_role() = 'admin' OR
      (attendai.actor_role() = 'student' AND EXISTS
        (SELECT 1 FROM attendai.students WHERE id = sid AND user_id = attendai.actor_id())) OR
      (attendai.actor_role() = 'teacher' AND EXISTS
        (SELECT 1 FROM attendai.enrollments e JOIN attendai.courses c ON c.id = e.course_id
         WHERE e.student_id = sid AND c.teacher_id = attendai.actor_id())), false) $$;

-- A frozen membership list, independent of later enrollment changes.
CREATE TABLE attendai.session_roster (
  session_id uuid NOT NULL,
  course_id uuid NOT NULL,
  student_id uuid NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (session_id, student_id),
  FOREIGN KEY (session_id, course_id) REFERENCES attendai.sessions(id, course_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, student_id) REFERENCES attendai.enrollments(course_id, student_id) ON DELETE RESTRICT
);
CREATE INDEX session_roster_student_idx ON attendai.session_roster(student_id);
ALTER TABLE attendai.session_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.attendance_records ADD CONSTRAINT attendance_frozen_roster_fk
  FOREIGN KEY (session_id, student_id) REFERENCES attendai.session_roster(session_id, student_id) ON DELETE RESTRICT;

CREATE FUNCTION attendai.read_mark(rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT EXISTS (SELECT 1 FROM attendai.attendance_records r
      WHERE r.id = rid AND (attendai.manage_course(r.course_id) OR
        (attendai.actor_role() = 'student' AND EXISTS
          (SELECT 1 FROM attendai.students s WHERE s.id = r.student_id AND s.user_id = attendai.actor_id())))) $$;

CREATE POLICY students_read ON attendai.students FOR SELECT TO attendai_app USING (attendai.read_student(id));
CREATE POLICY students_add ON attendai.students FOR INSERT TO attendai_app WITH CHECK (attendai.actor_role() = 'admin');
CREATE POLICY students_link ON attendai.students FOR UPDATE TO attendai_app
  USING (attendai.actor_role() = 'admin') WITH CHECK (attendai.actor_role() = 'admin');
CREATE POLICY courses_read ON attendai.courses FOR SELECT TO attendai_app USING (attendai.read_course(id));
CREATE POLICY courses_add ON attendai.courses FOR INSERT TO attendai_app WITH CHECK (attendai.actor_role() = 'admin');
CREATE POLICY enrollments_read ON attendai.enrollments FOR SELECT TO attendai_app USING
  (attendai.manage_course(course_id) OR (attendai.actor_role() = 'student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id = student_id AND s.user_id = attendai.actor_id())));
CREATE POLICY enrollments_add ON attendai.enrollments FOR INSERT TO attendai_app WITH CHECK (attendai.actor_role() = 'admin');
CREATE POLICY enrollments_change ON attendai.enrollments FOR UPDATE TO attendai_app
  USING (attendai.actor_role() = 'admin') WITH CHECK (attendai.actor_role() = 'admin');
CREATE POLICY sessions_read ON attendai.sessions FOR SELECT TO attendai_app USING
  (attendai.manage_course(course_id) OR (attendai.actor_role() = 'student' AND
    (EXISTS (SELECT 1 FROM attendai.session_roster r WHERE r.session_id = sessions.id)
     OR (state = 'scheduled' AND EXISTS (SELECT 1 FROM attendai.enrollments e
       JOIN attendai.students s ON s.id = e.student_id
       WHERE e.course_id = sessions.course_id AND e.is_active AND s.user_id = attendai.actor_id())))));
CREATE POLICY sessions_add ON attendai.sessions FOR INSERT TO attendai_app WITH CHECK
  (attendai.manage_course(course_id) AND created_by = attendai.actor_id() AND state = 'scheduled');
CREATE POLICY sessions_change ON attendai.sessions FOR UPDATE TO attendai_app
  USING (attendai.manage_course(course_id)) WITH CHECK (attendai.manage_course(course_id));
CREATE POLICY roster_read ON attendai.session_roster FOR SELECT TO attendai_app USING
  (attendai.manage_course(course_id) OR (attendai.actor_role() = 'student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id = student_id AND s.user_id = attendai.actor_id())));
CREATE POLICY marks_read ON attendai.attendance_records FOR SELECT TO attendai_app USING
  (attendai.manage_course(course_id) OR (attendai.actor_role() = 'student' AND EXISTS
    (SELECT 1 FROM attendai.students s WHERE s.id = student_id AND s.user_id = attendai.actor_id())));
CREATE POLICY marks_add ON attendai.attendance_records FOR INSERT TO attendai_app WITH CHECK
  (attendai.manage_course(course_id) AND marked_by = attendai.actor_id());
CREATE POLICY marks_correct ON attendai.attendance_records FOR UPDATE TO attendai_app
  USING (attendai.manage_course(course_id))
  WITH CHECK (attendai.manage_course(course_id) AND marked_by = attendai.actor_id());
CREATE POLICY events_read ON attendai.attendance_events FOR SELECT TO attendai_app USING (attendai.read_mark(attendance_id));

-- Only these columns may be written by runtime; no history DML or deletes.
GRANT SELECT ON attendai.students, attendai.courses, attendai.enrollments,
  attendai.sessions, attendai.session_roster, attendai.attendance_records, attendai.attendance_events TO attendai_app;
GRANT INSERT(student_code, display_name, user_id) ON attendai.students TO attendai_app;
GRANT UPDATE(user_id) ON attendai.students TO attendai_app;
GRANT INSERT(course_code, title, teacher_id) ON attendai.courses TO attendai_app;
GRANT INSERT(course_id, student_id) ON attendai.enrollments TO attendai_app;
GRANT UPDATE(is_active) ON attendai.enrollments TO attendai_app;
GRANT INSERT(session_code, course_id, title, starts_at, ends_at, created_by) ON attendai.sessions TO attendai_app;
GRANT UPDATE(state) ON attendai.sessions TO attendai_app;
GRANT INSERT(session_id, course_id, student_id, status, marked_by, change_reason) ON attendai.attendance_records TO attendai_app;
GRANT UPDATE(status, marked_by, change_reason) ON attendai.attendance_records TO attendai_app;

CREATE FUNCTION attendai.guard_student_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An existing student account link cannot be reassigned.';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attendai.app_users
      WHERE id = NEW.user_id AND role = 'student' AND is_active AND auth_provider = 'better-auth') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Link an active student account.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_link_guard BEFORE INSERT OR UPDATE ON attendai.students
  FOR EACH ROW EXECUTE FUNCTION attendai.guard_student_link();
CREATE FUNCTION attendai.guard_course_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM attendai.app_users WHERE id = NEW.teacher_id
      AND role IN ('admin','teacher') AND is_active AND auth_provider = 'better-auth') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Assign an active teacher or administrator.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER course_owner_guard BEFORE INSERT OR UPDATE ON attendai.courses
  FOR EACH ROW EXECUTE FUNCTION attendai.guard_course_owner();

CREATE FUNCTION attendai.guard_enrollment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  -- Serializes membership changes with roster capture for this course.
  PERFORM 1 FROM attendai.courses WHERE id = NEW.course_id AND is_active FOR UPDATE;
  IF NOT FOUND OR (NEW.is_active AND NOT EXISTS
      (SELECT 1 FROM attendai.students WHERE id = NEW.student_id AND is_active)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Use an active course and student.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_guard BEFORE INSERT OR UPDATE ON attendai.enrollments
  FOR EACH ROW EXECUTE FUNCTION attendai.guard_enrollment();

CREATE FUNCTION attendai.guard_session_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'scheduled' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='New sessions must be scheduled.'; END IF;
    PERFORM 1 FROM attendai.courses WHERE id = NEW.course_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Use an active course.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF OLD.state = 'scheduled' AND NEW.state = 'open' THEN
    PERFORM 1 FROM attendai.courses WHERE id = NEW.course_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Use an active course.'; END IF;
    INSERT INTO attendai.session_roster(session_id, course_id, student_id)
      SELECT NEW.id, NEW.course_id, e.student_id FROM attendai.enrollments e
      JOIN attendai.students s ON s.id = e.student_id
      WHERE e.course_id = NEW.course_id AND e.is_active AND s.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Enroll at least one active student before opening attendance.'; END IF;
  ELSIF OLD.state = 'open' AND NEW.state = 'closed' THEN
    IF EXISTS (SELECT 1 FROM attendai.session_roster r WHERE r.session_id = NEW.id
        AND NOT EXISTS (SELECT 1 FROM attendai.attendance_records a
          WHERE a.session_id = r.session_id AND a.student_id = r.student_id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Record a status for every student before closing attendance.';
    END IF;
  ELSIF OLD.state = 'scheduled' AND NEW.state = 'cancelled' THEN NULL;
  ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='This session state transition is not allowed.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_state_guard BEFORE INSERT OR UPDATE OF state ON attendai.sessions
  FOR EACH ROW EXECUTE FUNCTION attendai.guard_session_state();

CREATE FUNCTION attendai.guard_register_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE session_state text;
BEGIN
  SELECT state INTO session_state FROM attendai.sessions WHERE id = NEW.session_id FOR UPDATE;
  IF (TG_OP = 'INSERT' AND session_state IS DISTINCT FROM 'open')
     OR (TG_OP = 'UPDATE' AND session_state NOT IN ('open','closed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Open attendance before marking; corrections require an open or closed session.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER register_state_guard BEFORE INSERT OR UPDATE ON attendai.attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendai.guard_register_write();

-- Events are inserted ONLY by the owner-controlled trigger, atomically with a
-- mark. Runtime cannot forge, update, delete, or truncate the event log.
ALTER FUNCTION attendai.append_attendance_event() SECURITY DEFINER;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA attendai FROM PUBLIC;
REVOKE ALL ON attendai.session_roster FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendai.actor_id(), attendai.actor_role(), attendai.manage_course(uuid),
  attendai.read_course(uuid), attendai.read_student(uuid), attendai.read_mark(uuid) TO attendai_app;
INSERT INTO attendai.schema_migrations(version, description)
VALUES ('003', 'Persistent register, frozen session rosters, scoped access, and correction receipts');
COMMIT;
SELECT 'Schema 003 applied' AS result,
       (SELECT count(*)::integer FROM attendai.schema_migrations WHERE version IN ('001','002','003')) AS migrations_recorded;
