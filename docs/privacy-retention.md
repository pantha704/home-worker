# Privacy and retention

Status: v0.2.0 local and free-hosted engineering baseline  
Last reviewed: 2026-08-03

This is an engineering baseline, not legal advice. An operator serving other people must publish accurate terms/privacy notices and assess applicable education, child, copyright, biometric, and data-protection law.

## Data inventory

| Data | Local profile | Free hosted profile | Default lifecycle |
|---|---|---|---|
| Source PDF/image and display filename | Local object root | Private Supabase Storage + owner-scoped PostgreSQL metadata | Project deletion; hosted expiry after 14 days |
| Source digest, page metadata, immutable extraction evidence | SQLite revisions | Supabase PostgreSQL revisions | Same as project |
| User corrections/settings | SQLite revisions | Supabase PostgreSQL revisions | Same as project |
| Cached PDFs/text + integrity metadata | Local/private objects as produced | Private Supabase Storage + artifact rows | Same as project |
| Account/session | None | Supabase Auth | Supabase/operator account policy |
| Request/job IDs, timing, error codes | Process logs | Render logs | Vendor/operator log policy |
| Raw document text in logs/analytics | Prohibited | Prohibited | Never by default |

Cloudflare Pages serves static JavaScript/CSS and is not the document upload destination. The browser sends documents directly to the authenticated Render API, which stores authoritative bytes privately in Supabase. No paid OCR, AI model, analytics, remote font, or telemetry provider receives document content.

## Principles

- Collect only what extraction, review, export, integrity, safety, and recovery require.
- Keep provenance immutable and text corrections explicit.
- Never use customer content to train models or handwriting personas.
- Never expose a source/artifact bucket publicly or place server/database secrets in browser variables.
- Treat handwriting samples as potentially identifying; custom handwriting training and cloning are excluded.
- Stop new work at quotas instead of enabling billable overages.

## Access and deletion

Local mode relies on the host OS account and loopback binding. Hosted mode verifies a Supabase bearer token and scopes every query/object key to its UUID subject. Cross-account probes return the same `404` as a random project ID.

`DELETE /v1/projects/{id}?expectedRevision=N` checks ownership and optimistic concurrency. It removes the project and dependent revision/job/artifact state transactionally and writes object keys to a deletion outbox. Private Storage cleanup is retried without restoring the deleted project. Successful deletion returns `204`.

Hosted projects receive an expiry timestamp at creation. The leased worker periodically expires projects older than the configured 14-day default and processes the deletion outbox. The operator must verify this behavior on the deployed services and state any backup/log deletion delay in the public notice. Backups are not magically rewritten; restoring one requires deletion reconciliation.

## Logs and diagnostics

Allowed fields: timestamp, release, request/job/project opaque ID, route template, status, duration, byte/page/block counts, extractor/renderer version, and warning/error code.

Never log raw bodies, OCR text, edits, filenames, query strings, cookies, authorization headers, database/storage keys, secrets, absolute host paths, or full client IPs by default. Debugging remains time-limited and content-redacted.

## External service boundaries

The free hosted profile uses three processors:

- Cloudflare Pages: static web assets.
- Render: API and temporary OCR/render computation.
- Supabase: email authentication, PostgreSQL, and private Storage.

Operators must review each provider's current region, retention, subprocessors, availability, and free-plan terms before launch. Real credentials belong only in provider secret settings. Optional Ollama remains local-only and disabled in the hosted profile.

## Children and institutions

Homeworker v0.2.0 is not a child-directed or institution-administered service. It does not implement verified parental consent, guardian/school workflows, education-record agreements, or institutional administration. Do not market or deploy it for those cases until legal/product review and necessary controls exist.

## Operator checklist

- Apply the reviewed Supabase migration; confirm tables and bucket are not browser-accessible.
- Set exact Cloudflare and API origins and verify two-account isolation.
- Keep all three vendors on Free plans without automatic upgrades or a paid Render disk.
- Test expiry, deletion-outbox retry, session expiry, restart recovery, and artifact hashes.
- Publish retention, provider, contact, and deletion terms before inviting users.
- Scale or pay only after measured user load and explicit owner approval.
