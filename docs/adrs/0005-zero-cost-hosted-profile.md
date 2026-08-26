# ADR-0005: Zero-cost hosted public-beta profile

Date: 2026-08-03  
Status: accepted for v0.2.0 beta

## Context

Homeworker needs an authenticated internet deployment before there is revenue or measured scale. OCR and PDF rendering need a conventional CPU process, while user documents, job state, and revisions cannot live on a free compute service's ephemeral disk. The owner does not want automatic charges.

## Decision

Use Cloudflare Pages Free for the static Next.js export, Supabase Free for magic-link Auth/PostgreSQL/private Storage, and one Render Free web service for FastAPI, Tesseract, and a leased in-process worker. Apply hard application quotas below shared free allowances. Do not attach a Render disk, enable a paid plan, or require a custom domain. Treat the compute filesystem as temporary.

The API verifies Supabase JWTs and owns all data access. Browser roles have no table or bucket policy. Jobs, ownership, revisions, sources, artifacts, retention, and rate counters are durable in Supabase. Free-tier exhaustion rejects/pauses work; it never triggers an automatic application upgrade.

## Consequences

Launch cost can remain $0, but the service is cold-start tolerant rather than always-on. Free projects may sleep/pause, quotas are shared, and providers can change limits. The profile is intentionally one compute instance. Live provider, two-account isolation, restart, retention, and deletion tests remain deployment gates. Scaling later is a deliberate architecture/billing decision based on measured load.
