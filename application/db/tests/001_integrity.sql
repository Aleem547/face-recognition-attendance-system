-- Run after migration 001, on the DEVELOPMENT branch, as the database owner.
-- All sample rows and test objects are rolled back. Identity sequences can
-- advance during rolled-back inserts; gaps in event IDs are normal.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE attendai_001_test_result (checks_passed integer NOT NULL);

DO $test$
DECLARE
    checked integer := 0;
    constraint_seen text;
    prefix text := 'T-' || replace(gen_random_uuid()::text, '-', '');
    teacher uuid := gen_random_uuid();
    student_one uuid := gen_random_uuid();
    student_two uuid := gen_random_uuid();
    course_one uuid := gen_random_uuid();
    course_two uuid := gen_random_uuid();
    session_one uuid := gen_random_uuid();
    session_two uuid := gen_random_uuid();
    session_three uuid := gen_random_uuid();
    attendance_one uuid := gen_random_uuid();
    first_recorded_at timestamptz;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '001') THEN
        RAISE EXCEPTION 'Migration 001 is missing.';
    END IF;
    checked := checked + 1;

    INSERT INTO attendai.app_users (id, display_name, role)
    VALUES (teacher, 'Synthetic Test Teacher', 'teacher');
    INSERT INTO attendai.students (id, student_code, display_name)
    VALUES (student_one, prefix || '-1', 'Synthetic Test Student One'),
           (student_two, prefix || '-2', 'Synthetic Test Student Two');
    INSERT INTO attendai.courses (id, course_code, title, teacher_id)
    VALUES (course_one, prefix || '-A', 'Synthetic Test Course A', teacher),
           (course_two, prefix || '-B', 'Synthetic Test Course B', teacher);
    INSERT INTO attendai.enrollments (course_id, student_id)
    VALUES (course_one, student_one), (course_two, student_one),
           (course_two, student_two);
    INSERT INTO attendai.sessions
        (id, session_code, course_id, title, starts_at, ends_at, state, created_by)
    VALUES
        (session_one, prefix || '-S1', course_one, 'Synthetic Test Session A1',
         '2030-01-01 09:00:00+00', '2030-01-01 10:00:00+00', 'open', teacher),
        (session_two, prefix || '-S2', course_two, 'Synthetic Test Session B1',
         '2030-01-01 11:00:00+00', '2030-01-01 12:00:00+00', 'open', teacher),
        (session_three, prefix || '-S3', course_one, 'Synthetic Test Session A2',
         '2030-01-01 14:00:00+00', '2030-01-01 15:00:00+00', 'open', teacher);

    INSERT INTO attendai.attendance_records
        (id, session_id, course_id, student_id, status, marked_by, change_reason)
    VALUES (attendance_one, session_one, course_one, student_one,
            'present', teacher, 'Synthetic initial manual mark');
    IF NOT EXISTS (
        SELECT 1 FROM attendai.attendance_records
        WHERE id = attendance_one AND revision = 1 AND method = 'manual'
    ) OR NOT EXISTS (
        SELECT 1 FROM attendai.attendance_events
        WHERE attendance_id = attendance_one AND revision = 1
          AND action = 'created' AND previous_status IS NULL AND new_status = 'present'
    ) THEN
        RAISE EXCEPTION 'Valid attendance did not create its initial history event.';
    END IF;
    SELECT recorded_at INTO first_recorded_at
    FROM attendai.attendance_records WHERE id = attendance_one;
    checked := checked + 1;

    BEGIN
        INSERT INTO attendai.attendance_records
            (session_id, course_id, student_id, status, marked_by, change_reason)
        VALUES (session_one, course_one, student_one, 'late', teacher, 'Duplicate attempt');
        RAISE EXCEPTION 'Duplicate attendance was accepted.';
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS constraint_seen = CONSTRAINT_NAME;
        IF constraint_seen <> 'attendance_one_per_student_session' THEN RAISE; END IF;
    END;
    checked := checked + 1;

    BEGIN
        INSERT INTO attendai.enrollments (course_id, student_id)
        VALUES (course_one, student_one);
        RAISE EXCEPTION 'Duplicate enrollment was accepted.';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    checked := checked + 1;

    -- Student one belongs to BOTH courses. The session-course FK must still
    -- reject using a course other than the one that owns the session.
    BEGIN
        INSERT INTO attendai.attendance_records
            (session_id, course_id, student_id, status, marked_by, change_reason)
        VALUES (session_three, course_two, student_one, 'present', teacher, 'Wrong course attempt');
        RAISE EXCEPTION 'Session linked to the wrong course was accepted.';
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS constraint_seen = CONSTRAINT_NAME;
        IF constraint_seen <> 'attendance_session_course_fk' THEN RAISE; END IF;
    END;
    checked := checked + 1;

    BEGIN
        INSERT INTO attendai.attendance_records
            (session_id, course_id, student_id, status, marked_by, change_reason)
        VALUES (session_one, course_one, student_two, 'present', teacher, 'Unenrolled attempt');
        RAISE EXCEPTION 'Student not enrolled in the course was accepted.';
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS constraint_seen = CONSTRAINT_NAME;
        IF constraint_seen <> 'attendance_enrollment_fk' THEN RAISE; END IF;
    END;
    checked := checked + 1;

    BEGIN
        INSERT INTO attendai.attendance_records
            (session_id, course_id, student_id, status, marked_by, change_reason)
        VALUES (gen_random_uuid(), course_one, student_one, 'present', teacher, 'Unknown session');
        RAISE EXCEPTION 'Unknown session was accepted.';
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS constraint_seen = CONSTRAINT_NAME;
        IF constraint_seen <> 'attendance_session_course_fk' THEN RAISE; END IF;
    END;
    checked := checked + 1;

    -- Same student, same day, distinct sessions: both must be allowed.
    INSERT INTO attendai.attendance_records
        (session_id, course_id, student_id, status, marked_by, change_reason)
    VALUES (session_two, course_two, student_one, 'present', teacher, 'Other course session'),
           (session_three, course_one, student_one, 'present', teacher, 'Second session today');
    IF (SELECT count(*) FROM attendai.attendance_records WHERE student_id = student_one) <> 3 THEN
        RAISE EXCEPTION 'Attendance was incorrectly restricted to one mark per day.';
    END IF;
    checked := checked + 1;

    UPDATE attendai.attendance_records
    SET status = 'late', marked_by = teacher, change_reason = 'Synthetic teacher correction'
    WHERE id = attendance_one;
    IF NOT EXISTS (
        SELECT 1 FROM attendai.attendance_records
        WHERE id = attendance_one AND status = 'late' AND revision = 2
          AND recorded_at = first_recorded_at AND updated_at >= recorded_at
    ) OR NOT EXISTS (
        SELECT 1 FROM attendai.attendance_events
        WHERE attendance_id = attendance_one AND revision = 2 AND action = 'corrected'
          AND previous_status = 'present' AND new_status = 'late'
          AND actor_id = teacher AND reason = 'Synthetic teacher correction'
    ) THEN
        RAISE EXCEPTION 'Correction did not preserve the initial mark and append history.';
    END IF;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_records SET status = 'absent', change_reason = '   '
        WHERE id = attendance_one;
        RAISE EXCEPTION 'Blank correction reason was accepted.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_records SET status = 'unknown'
        WHERE id = attendance_one;
        RAISE EXCEPTION 'Unsupported attendance status was accepted.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_records SET method = 'face'
        WHERE id = attendance_one;
        RAISE EXCEPTION 'Unimplemented face method was accepted.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_records SET student_id = student_two
        WHERE id = attendance_one;
        RAISE EXCEPTION 'Existing attendance was moved to another student.';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_records SET recorded_at = recorded_at - interval '1 hour'
        WHERE id = attendance_one;
        RAISE EXCEPTION 'Original attendance timestamp was changed.';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.sessions SET ends_at = starts_at WHERE id = session_one;
        RAISE EXCEPTION 'Invalid session time range was accepted.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        INSERT INTO attendai.app_users (display_name, role, auth_subject)
        VALUES ('Synthetic Incomplete Identity', 'student', prefix);
        RAISE EXCEPTION 'Auth subject without provider was accepted.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        DELETE FROM attendai.attendance_events WHERE attendance_id = attendance_one;
        RAISE EXCEPTION 'History deletion was accepted.';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        UPDATE attendai.attendance_events SET reason = 'Rewritten history'
        WHERE attendance_id = attendance_one;
        RAISE EXCEPTION 'History rewriting was accepted.';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        DELETE FROM attendai.attendance_records WHERE id = attendance_one;
        RAISE EXCEPTION 'Attendance deletion was accepted.';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    checked := checked + 1;

    BEGIN
        DELETE FROM attendai.enrollments
        WHERE course_id = course_one AND student_id = student_one;
        RAISE EXCEPTION 'Enrollment with retained attendance was deleted.';
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
    END;
    checked := checked + 1;

    IF (SELECT count(*) FROM attendai.attendance_events WHERE attendance_id = attendance_one) <> 2
       OR (SELECT revision FROM attendai.attendance_records WHERE id = attendance_one) <> 2 THEN
        RAISE EXCEPTION 'A rejected write left an extra revision or history event.';
    END IF;
    checked := checked + 1;

    IF (SELECT count(*) FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'attendai' AND c.relkind = 'r' AND c.relrowsecurity) <> 8 THEN
        RAISE EXCEPTION 'Not all eight tables have RLS enabled.';
    END IF;
    checked := checked + 1;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace n,
            LATERAL pg_catalog.aclexplode(
                coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
            ) AS acl
        WHERE n.nspname = 'attendai' AND acl.grantee = 0
    ) THEN
        RAISE EXCEPTION 'PUBLIC has unexpected schema privileges.';
    END IF;
    checked := checked + 1;

    INSERT INTO pg_temp.attendai_001_test_result VALUES (checked);
END;
$test$;

SELECT 'PASS' AS result, checks_passed,
       'Synthetic test rows are rolled back by the final statement.' AS note
FROM pg_temp.attendai_001_test_result;

ROLLBACK;
