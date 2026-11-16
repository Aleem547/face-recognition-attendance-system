-- Additive account onboarding. Apply once as the database owner.
-- Existing users, student links, attendance and biometric references are preserved.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '003') THEN
    RAISE EXCEPTION 'Apply migration 003 before student registration.';
  END IF;
  IF EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '010') THEN
    RAISE EXCEPTION 'Migration 010 is already applied. Do not drop or recreate account records.';
  END IF;
END $guard$;

CREATE TABLE attendai.student_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL UNIQUE REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
  student_code text NOT NULL CHECK (student_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES attendai.app_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  CHECK ((status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX student_registrations_pending_idx ON attendai.student_registrations(created_at,id) WHERE status = 'pending';
ALTER TABLE attendai.student_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY registrations_admin_read ON attendai.student_registrations
  FOR SELECT TO attendai_app USING (attendai.actor_role() = 'admin');
REVOKE ALL ON attendai.student_registrations FROM PUBLIC;
GRANT SELECT ON attendai.student_registrations TO attendai_app;

-- Called only by the trusted server after Better Auth created the credential.
-- Identity details come from the auth record, never from a requested app role.
CREATE FUNCTION attendai.register_student_account(auth_id text, requested_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE auth_user attendai_auth.users%ROWTYPE; profile_id uuid; request_id uuid;
BEGIN
  IF auth_id IS NULL OR char_length(auth_id) NOT BETWEEN 1 AND 255
     OR requested_code IS NULL OR requested_code !~ '^[A-Z0-9][A-Z0-9._-]{0,39}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid student registration.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('student-registration:' || auth_id,0));
  SELECT * INTO auth_user FROM attendai_auth.users WHERE id=auth_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Authentication account is unavailable.'; END IF;
  SELECT id INTO profile_id FROM attendai.app_users
    WHERE auth_provider='better-auth' AND auth_subject=auth_id FOR UPDATE;
  IF FOUND THEN
    SELECT id INTO request_id FROM attendai.student_registrations WHERE app_user_id=profile_id;
    IF request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='An existing account cannot be registered again.'; END IF;
    RETURN request_id;
  END IF;
  INSERT INTO attendai.app_users(auth_provider,auth_subject,display_name,email,role,is_active)
    VALUES('better-auth',auth_id,auth_user.name,lower(btrim(auth_user.email)),'student',false)
    RETURNING id INTO profile_id;
  INSERT INTO attendai.student_registrations(app_user_id,student_code)
    VALUES(profile_id,requested_code) RETURNING id INTO request_id;
  RETURN request_id;
END $$;

-- The server supplies the ID from a verified session, not a request parameter.
CREATE FUNCTION attendai.student_registration_status(auth_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('status',r.status,'studentCode',r.student_code,
    'name',u.display_name,'email',u.email,'createdAt',r.created_at)
  FROM attendai.student_registrations r JOIN attendai.app_users u ON u.id=r.app_user_id
  WHERE u.auth_provider='better-auth' AND u.auth_subject=auth_id
$$;

CREATE FUNCTION attendai.review_student_registration(request_id uuid, decision text, existing_student uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE registration attendai.student_registrations%ROWTYPE; student_id uuid;
BEGIN
  IF attendai.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Administrator access required.';
  END IF;
  IF decision NOT IN ('approve','reject') OR decision IS NULL
     OR (decision='reject' AND existing_student IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid registration decision.';
  END IF;
  SELECT * INTO registration FROM attendai.student_registrations WHERE id=request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Registration unavailable.'; END IF;
  IF registration.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='This registration has already been reviewed.';
  END IF;
  PERFORM 1 FROM attendai.app_users WHERE id=registration.app_user_id
    AND auth_provider='better-auth' AND role='student' AND NOT is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Account state changed. Refresh before reviewing.'; END IF;
  IF decision='approve' THEN
    IF existing_student IS NOT NULL THEN
      PERFORM 1 FROM attendai.students WHERE id=existing_student AND user_id IS NULL AND is_active FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Choose an active, unlinked student record.'; END IF;
    END IF;
    UPDATE attendai.app_users SET is_active=true WHERE id=registration.app_user_id;
    IF existing_student IS NULL THEN
      INSERT INTO attendai.students(student_code,display_name,user_id)
        SELECT registration.student_code,display_name,id FROM attendai.app_users WHERE id=registration.app_user_id
        RETURNING id INTO student_id;
    ELSE
      UPDATE attendai.students SET user_id=registration.app_user_id WHERE id=existing_student
        RETURNING id INTO student_id;
    END IF;
  END IF;
  UPDATE attendai.student_registrations SET status=CASE WHEN decision='approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_by=attendai.actor_id(),reviewed_at=current_timestamp WHERE id=request_id;
  RETURN jsonb_build_object('status',CASE WHEN decision='approve' THEN 'approved' ELSE 'rejected' END,'studentId',student_id);
END $$;

REVOKE ALL ON FUNCTION attendai.register_student_account(text,text),
  attendai.student_registration_status(text),attendai.review_student_registration(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendai.register_student_account(text,text),
  attendai.student_registration_status(text),attendai.review_student_registration(uuid,text,uuid) TO attendai_app;
INSERT INTO attendai.schema_migrations(version,description)
  VALUES('010','Student self-registration, pending access and administrator approval');
COMMIT;
