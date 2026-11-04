# Free Render demo

This deployment uses one Docker web service on Render's **Free** compute plan and the existing external PostgreSQL configuration. It creates no Render database, paid worker, disk, cron job or custom domain. A free hosted database elsewhere remains subject to its own limits. The Render host has not yet been deployed or measured.

## Limits to expect

- Render Free currently provides **0.1 CPU and 512 MB RAM**. The complete Next.js plus Python face/PAD workload has not been measured on this allocation. CPU face processing may be slow or the service may run out of memory. A successful image build or health check does not establish capacity. If it cannot run in this allowance, stop and review a different free option; do not upgrade automatically.
- After **15 minutes without incoming traffic**, the service sleeps. A visitor wakes it, normally after about one minute. The app's class clock and resident comparison worker do not run while it sleeps. Clock gaps continue to require staff review; automatic absences are not fabricated for an unobserved interval.
- Render can restart the service. A running live comparison then needs to be started again. Saved attendance and encrypted templates remain in the external database.
- The Free web service quota is 750 instance-hours per workspace per month, shared with its other Free web services. Bandwidth and build quotas also apply. Keep the workspace on its free plan and do not add a payment method or accept a paid upgrade for this demo. If Render requires payment, stop at that screen and review the requirement.
- Do not use artificial keep-alive traffic to hide the sleeping limitation. This is a public research demo; dependable unattended attendance and face/PAD reliability remain unconfirmed.

## Publish the prepared source branch

The Render update package contains a preparation helper. It checks the exact previous Docker preparation, applies only this update, verifies the source release and creates a `render-free-...` branch. With `-Publish`, it commits the allowlisted source using your existing Git identity and pushes that branch to the existing project repository. It never force-pushes or changes `main`. It does not modify the installed app or start a public service.

Use the package's PowerShell command on Windows. A second invocation reuses the prepared branch and does not create a second commit if the source is unchanged. Preserve the displayed **Render branch** name for service creation.

## Create the service

1. Open [Render](https://dashboard.render.com/) and sign in with GitHub. Authorize access to `Aleem547/face-recognition-attendance-system`.
2. Choose **New > Blueprint**, select that repository and the printed `render-free-...` branch. The Blueprint path is `render.yaml` at the repository root. Leave the repository root directory blank. Do not select `application/` as the root: the Dockerfile needs the whole repository.
3. Confirm the preview creates **one web service on Free ($0)** and no database or paid resources. The Blueprint selects Singapore; it can be changed to a region nearer the existing database if necessary.
4. Enter the five prompted values from the existing private configuration, as described below. Review the service summary before submitting. Finish any timed class and stop the laptop's application container before starting the hosted service against the same database. Do not deliberately run two active app instances against the same database.
5. Deploy. The Docker build installs locked dependencies, verifies the four public model downloads, and builds Next.js. The container performs its existing read-only database/clock preflight before starting. A host build failure is not a reason to repeatedly reinstall the local app.
6. After creation, open the Blueprint's **Settings** and set **Auto Sync to No** before future source pushes. This keeps Blueprint configuration updates under manual control as well.

The app uses Render's assigned `https://....onrender.com` address for login automatically. No address needs to be guessed. Render provides the public HTTPS endpoint. Use one instance. Commit-triggered service deployments are disabled by `autoDeployTrigger: off`; the separate Blueprint Auto Sync setting defaults to On, so change it as described above. Deploy later reviewed commits deliberately from the service dashboard.

If creating a Web Service manually instead of a Blueprint, choose Docker, the printed branch, root directory blank, `./Dockerfile`, Docker context `.`, **Free**, and health path `/api/health`. Add the same five private settings and `PORT=10000`, `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`. Retain the Dockerfile's start command.

## Five private settings

Read the current runtime configuration on your own laptop. For example, the private Compose file previously exported under `Downloads\Face_Recognition_Private_Evidence` contains only selected runtime settings. You can also use the installed project's `.env.local`. Do not upload either file to GitHub or chat. Enter values directly into Render's private Environment fields.

| Key | Value to enter |
| --- | --- |
| `APP_DATABASE_URL` | The existing **restricted `attendai_app`** connection, with `sslmode=verify-full`. Preserve the database and encoded password. Never use the owner `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | The exact existing authentication secret. |
| `ATTENDAI_BIOMETRIC_KEY` | The exact original encryption key matching the existing templates. Do not generate a replacement. |
| `ATTENDAI_BIOMETRICS_ENABLED` | The existing `true`/`false` value. Use `false` if enrollment is intentionally disabled. |
| `ATTENDAI_VERIFICATION_TRIAL_ENABLED` | The existing `true`/`false` value. Comparison requires enrollment to be enabled. |

Do not copy `DATABASE_URL`, `FRAS_LOCAL_PREVIEW`, `FRAS_ENV_FILE`, or the old localhost `BETTER_AUTH_URL` into Render. The deployment adapter derives the assigned Render HTTPS origin only when no explicit origin is configured. Custom domains require an explicit HTTPS `BETTER_AUTH_URL`.

If the database restricts client network addresses, review the Render service's documented outbound addresses in the existing provider's network controls. Preserve certificate verification and the restricted runtime role. Certificate files referenced through Windows-only paths need an appropriate Render secret-file configuration. Do not disable TLS or publish the database to all networks as a shortcut.

## First hosted check

After Render reports the service as Live, open its public HTTPS URL, sign in and confirm the existing synthetic register is visible. Then try one camera comparison and inspect the host's memory/CPU metrics and any class-clock status warning. These are deployment-specific checks; earlier local tests do not need to be repeated. If the service is sleeping, visit it ahead of a demonstration and allow the initial startup to complete. Do not describe the in-process class clock as continuously available on this plan.

## Rollback

If the hosted service cannot run within the free allowance, suspend it in Render before starting the laptop container again. Neither source preparation nor publishing applies database migrations or rotates keys. Normal class-clock writes may occur once a configured app is actually started. Keep the private runtime configuration and the existing database backup. Do not delete the database or replace the encryption key.

## References

- [Render Free limits](https://render.com/docs/free)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Docker on Render](https://render.com/docs/docker)
- [Blueprint reference](https://render.com/docs/blueprint-spec)
- [Blueprint setup and Auto Sync](https://render.com/docs/infrastructure-as-code)
- [Default environment variables](https://render.com/docs/environment-variables)
- [Private environment settings](https://render.com/docs/configure-environment-variables)
