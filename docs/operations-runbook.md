# Operations runbook

Status: v0.2.0 local and free-hosted profiles  
Last reviewed: 2026-08-03

Never paste document content, tokens, database URLs, or Storage keys into incident tickets or logs.

## Local profile

Run from `infra/`:

```bash
cp .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
```

Open `http://localhost:3000`. API liveness/readiness are `http://localhost:8000/health` and `/ready`. `docker compose down` preserves named volumes; never add `--volumes` during routine operation.

The supplied backup script stops the API briefly and creates a checksummed copy of the full `ink_data` volume. Restore always targets a new volume:

```bash
./scripts/backup.sh ./backups
INK_RESTORE_VOLUME=homeworker-restore ./scripts/restore.sh ./backups/ink-data-YYYYMMDDTHHMMSSZ.tar.gz
```

Validate readiness, several revisions, source/export digests, exact A4 output, and post-backup deletions before cutover.

## Free hosted profile

The hosted source of truth is Supabase PostgreSQL and private Storage. Cloudflare is static, and Render's filesystem is disposable.

Daily checks:

- Render `/health` and `/ready`, restart/cold-start failures, queue age, final job failures, and memory/CPU.
- Supabase database/storage usage, paused-project state, Auth email delivery, connection failures, and backup status available to the current plan.
- Cloudflare build/deployment status and the exact `_headers` policy.
- Upload/project/storage/rate rejections; these are expected guardrails, not reasons to enable billing automatically.

Weekly checks:

- Two-account isolation and session-expiry probe.
- Queued-job restart recovery, 14-day expiry, and deletion-outbox drain.
- Manifest SHA-256 against a freshly downloaded artifact.
- Dependency/security alerts and free-plan limit/term changes.

## Health interpretation

| Signal | Meaning | First response |
|---|---|---|
| Web unavailable | Cloudflare/static build issue | Inspect deployment and build variables; do not put secrets in browser config |
| API live, not ready | PostgreSQL or private Storage unavailable/misconfigured | Pause invites; verify Supabase/Render secrets and migration |
| Processing remains queued | Render asleep/restarting or lease/worker issue | Wake API, inspect metadata-only job state, verify one worker is enabled |
| Upload gets `429`/quota error | Intentional free-tier boundary | Wait/delete old projects/reduce invites; do not auto-upgrade |
| Export integrity failure | Cached object differs from immutable metadata | Disable affected download, preserve digests, regenerate from revision |
| Cross-user access succeeds | Critical tenant isolation incident | Disable public API immediately, preserve metadata logs, rotate sessions/secrets |

## Upgrade and rollback

1. Review dependency, schema, persona, legal, privacy, and free-plan changes.
2. Run release audit, backend/frontend/contract tests, hosted static build, real OCR smoke, and visual/structural PDF checks.
3. Apply migrations to a non-production Supabase project first and run the two-account/restart acceptance flow.
4. Record current commit/image/build and database backup/restore point.
5. Deploy API, verify readiness, then publish static web.
6. Roll back code/build if compatible. Never guess at a database downgrade; restore into an isolated project if required.

## Incidents

### Parser/OCR crash or suspected malicious input

Stop repeated retries for the digest class, preserve metadata only, check process/temp/resource behavior, patch dependencies/rules, and add a rights-controlled regression fixture before resuming.

### Possible disclosure

Disable affected API/download paths, preserve content-free access/security logs, determine accounts/objects/time range, rotate affected sessions/secrets, correct authorization/configuration, and follow applicable notification law.

### Fidelity or provenance defect

Block affected exports; preserve source digest, exact revision, settings, seed, persona, artifact, and manifest. Fix without rewriting immutable evidence, then add regression and golden-PDF coverage.

### Storage cleanup delayed

Keep the project deleted. Verify the deletion outbox and Supabase Storage availability, then allow the worker to retry exact server-generated keys. Never delete by filename or recreate database rows to trigger cleanup.

### Free capacity pressure

Stop invitations/uploads, shorten future retention if the public policy permits, ask users to delete/export completed work, and verify stale objects are draining. A paid upgrade requires explicit owner approval and measured demand.
