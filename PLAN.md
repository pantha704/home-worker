# Homeworker - Execution Plan

Every implementation block begins by rereading `CONTEXT.md`, this plan, and the acceptance criteria relevant to that block.

## Current plan - v0.2.0 free public foundation

1. Preserve the complete local profile and add a fail-closed hosted configuration profile.
2. Add Supabase JWT verification, owner-scoped persistence, private object storage, and RLS-ready
   migrations without exposing a service or database secret to the browser.
3. Move hosted extraction into a durable leased job queue with retries and restart recovery.
4. Add per-user upload rates, project/revision/storage ceilings, retention, and immutable export
   caching so the free tiers have explicit boundaries.
5. Add hosted web authentication, bearer-token API calls, authenticated artifact downloads, and
   accurate local-versus-hosted privacy copy.
6. Add Cloudflare Pages, Render Free, and Supabase Free setup assets with no billing requirement.
7. Run lint, strict types, unit/integration tests, a real OCR smoke, PDF structural/visual checks,
   and a clean fresh-extraction release audit.

## Acceptance gates

- `purpose`: output remains faithful to user-reviewed source content.
- `safety`: restricted document/persona uses are rejected or clearly excluded.
- `contracts`: web and API share versioned schemas.
- `local-first`: core path works without cloud credentials.
- `print`: A4 output passes geometry and visual inspection.
- `quality`: format, lint, type-check, unit/integration tests, build, and smoke tests pass.
- `delivery`: ZIP excludes caches, secrets, local databases, uploads, and generated dependency folders.
- `tenancy`: every project, revision, job, artifact, and object key is owner scoped.
- `durability`: queued work and source bytes survive API restarts in hosted mode.
- `free-launch`: no paid plan, card-backed overage, paid API, or paid persistent disk is required.
- `public-config`: hosted mode refuses to start without Auth, PostgreSQL, Storage, and exact origins.
