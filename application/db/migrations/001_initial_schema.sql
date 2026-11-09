BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA attendai;
REVOKE ALL ON SCHEMA attendai FROM PUBLIC;

CREATE TABLE attendai.schema_migrations (
    version text PRIMARY KEY,
    description text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT current_timestamp
);

-- Application profiles only. Authentication and identity verification are
-- separate, unfinished work. Auth provider IDs remain text, not assumed UUIDs.
CREATE TABLE attendai.app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_provider text,
    auth_subject text,
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
    email text CHECK (email IS NULL OR char_length(btrim(email)) BETWEEN 3 AND 254),
    role text NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT app_users_auth_pair CHECK (
        (auth_provider IS NULL) = (auth_subject IS NULL)
    ),
    CONSTRAINT app_users_provider_not_blank CHECK (
        auth_provider IS NULL OR char_length(btrim(auth_provider)) BETWEEN 1 AND 100
    ),
    CONSTRAINT app_users_subject_not_blank CHECK (
        auth_subject IS NULL OR char_length(btrim(auth_subject)) BETWEEN 1 AND 255
    ),
    CONSTRAINT app_users_auth_identity UNIQUE (auth_provider, auth_subject)
);

CREATE UNIQUE INDEX app_users_email_unique
    ON attendai.app_users (lower(btrim(email))) WHERE email IS NOT NULL;

CREATE TABLE attendai.students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_code text NOT NULL UNIQUE
        CHECK (char_length(btrim(student_code)) BETWEEN 1 AND 40),
    display_name text NOT NULL
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
    user_id uuid UNIQUE REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE attendai.courses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code text NOT NULL UNIQUE
        CHECK (char_length(btrim(course_code)) BETWEEN 1 AND 40),
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    teacher_id uuid NOT NULL REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX courses_teacher_idx ON attendai.courses (teacher_id);

CREATE TABLE attendai.enrollments (
    course_id uuid NOT NULL REFERENCES attendai.courses(id) ON DELETE RESTRICT,
    student_id uuid NOT NULL REFERENCES attendai.students(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    enrolled_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (course_id, student_id)
);

CREATE INDEX enrollments_student_idx ON attendai.enrollments (student_id);

CREATE TABLE attendai.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code text NOT NULL UNIQUE
        CHECK (char_length(btrim(session_code)) BETWEEN 1 AND 60),
    course_id uuid NOT NULL REFERENCES attendai.courses(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    state text NOT NULL DEFAULT 'scheduled'
        CHECK (state IN ('scheduled', 'open', 'closed', 'cancelled')),
    created_by uuid NOT NULL REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    CONSTRAINT sessions_time_order CHECK (ends_at > starts_at),
    -- A course may have multiple sessions on the same day.
    CONSTRAINT sessions_id_course_unique UNIQUE (id, course_id)
);

CREATE INDEX sessions_course_time_idx ON attendai.sessions (course_id, starts_at);

CREATE TABLE attendai.attendance_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    course_id uuid NOT NULL,
    student_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    method text NOT NULL DEFAULT 'manual' CHECK (method = 'manual'),
    marked_by uuid NOT NULL REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
    change_reason text NOT NULL
        CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
    recorded_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    CONSTRAINT attendance_one_per_student_session UNIQUE (session_id, student_id),
    CONSTRAINT attendance_session_course_fk
        FOREIGN KEY (session_id, course_id)
        REFERENCES attendai.sessions(id, course_id) ON DELETE RESTRICT,
    CONSTRAINT attendance_enrollment_fk
        FOREIGN KEY (course_id, student_id)
        REFERENCES attendai.enrollments(course_id, student_id) ON DELETE RESTRICT
);

CREATE INDEX attendance_student_course_idx
    ON attendai.attendance_records (student_id, course_id);

CREATE TABLE attendai.attendance_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attendance_id uuid NOT NULL
        REFERENCES attendai.attendance_records(id) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision >= 1),
    action text NOT NULL CHECK (action IN ('created', 'corrected')),
    previous_status text CHECK (previous_status IN ('present', 'absent', 'late', 'excused')),
    new_status text NOT NULL CHECK (new_status IN ('present', 'absent', 'late', 'excused')),
    method text NOT NULL CHECK (method = 'manual'),
    actor_id uuid NOT NULL REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT attendance_events_revision_unique UNIQUE (attendance_id, revision),
    CONSTRAINT attendance_events_action_consistent CHECK (
        (action = 'created' AND previous_status IS NULL AND revision = 1)
        OR (action = 'corrected' AND previous_status IS NOT NULL AND revision > 1)
    )
);

-- Server-generated timestamps and revisions; an existing attendance row must
-- not be moved to another student, session, or course during a correction.
CREATE FUNCTION attendai.prepare_attendance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.recorded_at := clock_timestamp();
        NEW.updated_at := NEW.recorded_at;
        NEW.revision := 1;
    ELSE
        IF NEW.id IS DISTINCT FROM OLD.id
            OR NEW.session_id IS DISTINCT FROM OLD.session_id
            OR NEW.course_id IS DISTINCT FROM OLD.course_id
            OR NEW.student_id IS DISTINCT FROM OLD.student_id
            OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Attendance identity and initial timestamp cannot be changed.';
        END IF;
        NEW.updated_at := clock_timestamp();
        NEW.revision := OLD.revision + 1;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER attendance_prepare_write
    BEFORE INSERT OR UPDATE ON attendai.attendance_records
    FOR EACH ROW EXECUTE FUNCTION attendai.prepare_attendance_write();

-- Written in the SAME transaction as the attendance change.
CREATE FUNCTION attendai.append_attendance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO attendai.attendance_events
            (attendance_id, revision, action, previous_status, new_status,
             method, actor_id, reason)
        VALUES (NEW.id, NEW.revision, 'created', NULL, NEW.status,
                NEW.method, NEW.marked_by, NEW.change_reason);
    ELSE
        INSERT INTO attendai.attendance_events
            (attendance_id, revision, action, previous_status, new_status,
             method, actor_id, reason)
        VALUES (NEW.id, NEW.revision, 'corrected', OLD.status, NEW.status,
                NEW.method, NEW.marked_by, NEW.change_reason);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER attendance_append_event
    AFTER INSERT OR UPDATE ON attendai.attendance_records
    FOR EACH ROW EXECUTE FUNCTION attendai.append_attendance_event();

CREATE FUNCTION attendai.block_attendance_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'Attendance history cannot be deleted or rewritten through ordinary DML.';
END;
$function$;

CREATE TRIGGER attendance_block_delete
    BEFORE DELETE ON attendai.attendance_records
    FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER attendance_block_truncate
    BEFORE TRUNCATE ON attendai.attendance_records
    FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER events_block_update_delete
    BEFORE UPDATE OR DELETE ON attendai.attendance_events
    FOR EACH ROW EXECUTE FUNCTION attendai.block_attendance_history_mutation();
CREATE TRIGGER events_block_truncate
    BEFORE TRUNCATE ON attendai.attendance_events
    FOR EACH STATEMENT EXECUTE FUNCTION attendai.block_attendance_history_mutation();

-- No application-role policies or grants yet. Ordinary non-owner roles have
-- no access. The owner can bypass RLS: this does NOT implement user login,
-- teacher ownership checks, or production authorization.
ALTER TABLE attendai.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendai.attendance_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA attendai FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA attendai FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA attendai FROM PUBLIC;

INSERT INTO attendai.schema_migrations (version, description)
VALUES ('001', 'Initial attendance schema and transactional correction history');

COMMIT;

SELECT 'Schema 001 applied' AS result,
       current_database() AS database,
       count(*)::integer AS tables_created
FROM information_schema.tables
WHERE table_schema = 'attendai' AND table_type = 'BASE TABLE';
