# Deployment guide

Status: local profile; see linked hosted profile  
Last reviewed: 2026-08-03

The provided local stack requires no cloud service or API key. Its default ports bind to `127.0.0.1`; local mode intentionally has no login. Do not expose those ports to a LAN or internet. For an authenticated $0 launch path, use [the zero-cost public beta guide](free-public-deployment.md), not this Compose profile.

## Prerequisites

- A current Docker Engine/Desktop with Compose v2.
- 4 CPU cores, 8 GiB RAM, and 10 GiB free disk for a comfortable initial OCR workflow; smaller files may work with less.
- Enough additional encrypted storage for originals, temporary rasterization, exports, and backups.
- Git and a supported browser.

## Local setup

```bash
git clone <your-repository-url> homeworker
cd homeworker/infra
cp .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost:3000`. Data persists in the named `ink_data` volume. `docker compose down` keeps it; `docker compose down --volumes` deletes it and must not be used casually.

The first OCR language is English. Additional Tesseract language packs must be added deliberately to the API image/config and tested; accepting arbitrary runtime model downloads is not supported.

## Configuration

Review every value in `.env.example`, particularly upload/page/pixel/OCR limits, allowed browser origin and API URL, data volume name, and container resource ceilings. `NEXT_PUBLIC_*` values become browser-visible and must never contain secrets.

Core local operation has no required secret. Optional provider credentials are server-only and passed as mounted secret files or deployment secret mechanisms, never `NEXT_PUBLIC_*`, Compose YAML, an image layer, or a committed `.env`.

## Container hardening

Compose applies non-root users, dropped Linux capabilities, `no-new-privileges`, read-only root filesystems, bounded PIDs/CPU/memory, health checks, and isolated persistent/temp mounts. Treat these as defense in depth:

- keep Docker/host patched and use full-disk encryption;
- do not mount the Docker socket, host root, or arbitrary upload directories;
- keep parsing/OCR network egress denied where host/container networking supports it;
- use default seccomp/AppArmor/SELinux rather than disabling them;
- scan the built images and generate an SBOM for a release;
- pin reviewed base-image digests for release artifacts.

## Remote access

A public deployment is not “set the bind address to `0.0.0.0`.” The v0.2 hosted profile supplies authentication, owner isolation, private durable state, jobs, quotas, retention, and artifact manifests through the three free services. Follow its guide and live acceptance test. If designing a different remote topology, it still requires all of:

1. A free reverse proxy such as Caddy or nginx with TLS and strict request/time limits.
2. Real authentication, secure sessions, CSRF protection where applicable, password/OIDC account recovery, and per-project authorization on every API/download/job path.
3. Firewall rules exposing only 80/443; web and API remain on a private Docker network.
4. Exact public origins/hosts, secure headers, rate/concurrency limits, abuse controls, and monitoring.
5. Encrypted off-host backups, restore testing, retention/deletion jobs, published privacy/terms, and an incident contact.
6. Legal/product review before minors, institutions, custom personas, external providers, or shared/public exports.

Never expose local mode as a shortcut. A hosted deployment is approved only after its live-service, legal/license, privacy, and operational gates pass.

## Free hosting reality

OCR and PDF rendering are CPU/memory/disk intensive and often exceed free serverless limits. A user-owned PC, homelab, or existing VM is the most reliable zero-subscription deployment. “Free tier” vendors can suspend, change limits, lack persistent disk, or prohibit long CPU jobs; never make one a product dependency.

The free profile already keeps the static web separate and uses Supabase for durable PostgreSQL/objects while one Render process leases jobs. Measure queue time and storage before selecting any paid or multi-instance upgrade.

## Release procedure

- Build from a clean tagged commit with frozen dependencies.
- Run lint, type, unit/integration/E2E, malicious corpus, golden render, and Compose smoke checks.
- Record application image digests, SBOM, IR schema, DB migration, renderer, and persona package versions.
- Back up and restore-test current data.
- Deploy, verify liveness/readiness, then execute upload → review → deterministic preview → PDF/typed export.
- Observe errors, queue, memory, disk, and fidelity checks; keep old images and backup for rollback.

See [operations-runbook.md](operations-runbook.md) for backup, incidents, upgrades, and recovery.
