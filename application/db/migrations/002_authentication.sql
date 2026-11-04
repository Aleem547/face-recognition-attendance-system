-- Face Recognition Attendance System migration 002: Better Auth 1.7.12 and restricted runtime role.
-- Run ONCE as the owner, on the DEVELOPMENT branch, after migration 001.
-- No passwords or accounts are included. Configuration enables role login later.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM attendai.schema_migrations WHERE version = '001') THEN
        RAISE EXCEPTION 'Apply migration 001 first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'attendai_auth')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'attendai_app') THEN
        RAISE EXCEPTION 'Authentication schema or runtime role already exists. Inspect migration 002; do not drop existing objects.';
    END IF;
END;
$guard$;
CREATE ROLE attendai_app NOLOGIN NOINHERIT;

-- The following core schema was generated from the pinned Better Auth options
-- using better-auth/db/migration, the same migration planner used by its CLI.
create schema if not exists "attendai_auth";

create table "attendai_auth"."users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "attendai_auth"."sessions" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "attendai_auth"."users" ("id") on delete cascade);

create table "attendai_auth"."accounts" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "attendai_auth"."users" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "attendai_auth"."verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "attendai_auth"."rate_limits" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "sessions_userId_idx" on "attendai_auth"."sessions" ("userId");

create index "accounts_userId_idx" on "attendai_auth"."accounts" ("userId");

create index "verifications_identifier_idx" on "attendai_auth"."verifications" ("identifier");


-- Additional uniqueness for a provider's account identifier.
CREATE UNIQUE INDEX accounts_provider_account_unique
    ON attendai_auth.accounts ("providerId", "accountId");

REVOKE ALL ON SCHEMA attendai_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA attendai_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA attendai_auth FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA attendai_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA attendai_auth, attendai TO attendai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA attendai_auth TO attendai_app;

-- Runtime can read mapped application profiles, including active status and
-- roles, but cannot create profiles or grant itself a higher application role.
GRANT SELECT ON attendai.app_users TO attendai_app;
CREATE POLICY app_profile_runtime_read ON attendai.app_users
    FOR SELECT TO attendai_app USING (auth_provider = 'better-auth');

DO $connect$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO attendai_app', current_database());
    IF has_schema_privilege('attendai_app', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'PUBLIC schema CREATE is enabled for the runtime role. Review database privileges before proceeding.';
    END IF;
END;
$connect$;

INSERT INTO attendai.schema_migrations (version, description)
VALUES ('002', 'Better Auth accounts, database sessions, and restricted runtime access');
COMMIT;

SELECT 'Schema 002 applied' AS result, count(*)::integer AS auth_tables_created
FROM information_schema.tables
WHERE table_schema = 'attendai_auth' AND table_type = 'BASE TABLE';
