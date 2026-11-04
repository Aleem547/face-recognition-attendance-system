# Deployment preparation

This package prepares the existing local prototype for one continuously running Docker service. It does not create a public host, change DNS, apply SQL migrations, rotate keys, publish private configuration or establish biometric reliability. The previous acceptance gaps remain open.

## What is ready and what still needs a host

The Node build, isolated clock checks, read-only diagnostic, container configuration validation and native CPU model loading can be checked independently of Docker. The supplied validation report names the checks actually performed. **This preparation workspace has no Docker engine: the image build, container runtime, deployed camera and live database clock still require verification on the chosen host.** No memory minimum or production-readiness claim is made from a synthetic native-model check.

The image uses Debian Bookworm, Node.js 24 and 64-bit CPython 3.12. Web and Python dependencies use the committed lockfiles. Four public model weights are downloaded in the image build and verified against the existing size/hash manifests. Existing model licenses are retained. Mutable base-image tags receive updates; record the resolved image digests when building a release, and pin approved digests for repeat deployments.

## Read-only class-clock diagnosis

From `application/`, using the existing local configuration:

```powershell
node --env-file='C:\Path\To\Existing\Project\.env.local' scripts/clock-diagnostics.mjs --output 'C:\Private\New_Clock_Report.json'
```

The diagnostic uses only the restricted runtime connection, metadata SELECTs and a read-only transaction. It checks the role, clock objects, execute grant, security-definer setting, function-source match and the function owner's heartbeat permissions. It never invokes the clock or changes attendance. A passing result confirms these prerequisites; it does **not** prove that the warning has cleared or that a timed class finalized correctly.

Clock warnings now log fixed, allowlisted reason codes and guidance. They never log the original error message, connection URL, SQL detail, account data or encryption key. For example, `42501` points to permission review, `42883` to a missing function, and a recognized certificate code to trusted-CA review. Unknown errors remain redacted.

If the report identifies missing migration objects or grants, review the existing owner-only setup procedure. Do not grant owner privileges to the runtime role, bypass TLS verification, rerun recorded migrations or recreate tables. The local root cause is **unconfirmed until the operator's diagnostic result is available**.

## Build the image

Use Docker Desktop with Linux containers on Windows, or Docker Engine on an amd64 Linux host. Compose needs **2.30 or newer**, because raw environment-file handling preserves characters such as `$` in secrets. Run from the repository root:

```powershell
docker build --platform linux/amd64 -t face-recognition-attendance-system:deployment-prep .
```

Build-time model setup loads the face engine and both PAD models on CPU using synthetic checks. This tests model availability, not face/PAD accuracy. The image starts as UID/GID 10001. `tini` forwards termination to the process group, and the startup wrapper forwards shutdown to Next.js.

## Create private runtime configuration

From `application/`, export only the existing runtime settings into a **new file outside the repository**:

```powershell
node --env-file='C:\Path\To\Existing\Project\.env.local' scripts/export-container-env.mjs --origin 'http://localhost:3001' --output 'C:\Private\container.env'
```

The exporter preserves the original auth secret and biometric key when present, sets the selected origin, and omits the owner connection and unrelated environment values. It refuses existing output files and multiline values. Do not upload this private file or paste its contents into chat. `.env.container.example` is only a placeholder reference.

The web container requires the restricted `attendai_app` connection with explicit `sslmode=verify-full`. Keep the owner `DATABASE_URL` in trusted setup. A custom CA/client-certificate path must exist inside the container through an appropriate read-only secret mount; a Windows-only path cannot work unchanged on Linux. Do not disable TLS verification to work around a certificate error.

For a public host, use that host's HTTPS origin and secret configuration instead of localhost settings. Keep a dedicated synthetic/demo database or reviewed database branch separate from real attendance operations. A database copy containing encrypted templates needs the original matching encryption key. Start one application instance: live-comparison leases are currently process-local, and horizontal scaling is not validated.

## Local container preview

Finish any timed class before changing the active application environment. Starting the container enables its normal class-clock processing against its configured database; it is not a read-only action. The preparation helper does not start it automatically.

```powershell
$env:FRAS_ENV_FILE = 'C:\Private\container.env'
docker compose up -d --build
docker compose ps
```

Compose binds the preview only to `127.0.0.1:3001`, sets a read-only root filesystem, provides bounded writable temp/cache mounts, drops Linux capabilities and prevents privilege escalation. The raw environment file is kept outside the build context. The startup gate checks configuration and database metadata before starting Next.js. `/api/health` remains a process liveness check and does not certify database timing or biometrics.

Open `http://localhost:3001`. Verify signed-in access and a synthetic saved mark, native camera/comparison behavior and the clock's signed-in status. Keep real attendance data out of a public demonstration. Inspect actual container memory and CPU usage under the intended workload before selecting instance capacity.

## Public hosting decision

Use a Docker-capable host that can run the service continuously, connect to PostgreSQL and terminate HTTPS at a trusted reverse proxy or managed ingress. Keep the web port behind that ingress, retain origin checks, and use one instance. If sharing a server with another project, review available CPU/RAM, routing, port allocation and billing before changing it. No existing AWS or Vercel deployment is modified by this package.

Sleeping free services interrupt the in-process timer. Existing clock-gap handling deliberately sends affected classes for staff review rather than fabricating automatic absences. Hosting limitations must be reflected in the demo description. The face/PAD feature remains experimental even after a successful deployment.

References: [Next.js self-hosting](https://nextjs.org/docs/15/app/guides/self-hosting), [Docker Compose environment files](https://docs.docker.com/reference/compose-file/services/#env_file), [Render free-service limits](https://render.com/docs/free).
