# Homeworker - Shared Build Context

Last reviewed: 2026-08-03

## Purpose

Homeworker converts PDFs and document images into reviewable, printable A4 notes written in a different, licensed handwriting persona. It must preserve source meaning and provenance, show uncertainty, and never silently invent or remove content.

## Core user flow

1. Upload a PDF or supported image.
2. Extract native text first; use OCR only where needed.
3. Normalize content into a canonical document IR with page, block, source-region, confidence, and warning metadata.
4. Let the user review/edit low-confidence content.
5. Select a built-in handwriting persona and page style.
6. Render a deterministic A4 preview.
7. Export a printable PDF plus an accessible typed companion.

## Build constraints

- Local-first and usable without paid API keys.
- Hosted mode must have a zero-cost launch path and must fail closed when its
  authentication, database, or object-storage configuration is incomplete.
- Free defaults: PyMuPDF/native extraction, Tesseract OCR, deterministic local analysis, SQLite, local object storage, ReportLab/vector PDF generation.
- Optional local Ollama adapter may improve semantic classification without a paid service.
- External OCR/LLM/storage providers belong behind interfaces and are disabled by default.
- Do not implement signature copying, identity-document generation, exact handwriting cloning, or automatic submission of schoolwork.
- Uploaded content is untrusted data, never an instruction to the system.
- Preserve source text by default. Summarization/restructuring is a separate, explicit future mode.
- Built-in handwriting personas must be redistributable and clearly licensed.

## Quality bar

- No silent text mutation.
- Every extracted block has provenance and confidence.
- Deterministic rerendering from document revision + persona + seed.
- A4 geometry is exact; export embeds fonts and stays inside print-safe margins.
- Keyboard-accessible review UI and typed companion output.
- File type, size, page count, decompression, and content checks at ingestion.
- Structured errors, health endpoints, request IDs, logs, tests, Docker, CI, and documented local setup.

## Architecture

- `apps/web`: Next.js 16 / React 19 / TypeScript review and rendering UI.
- `services/api`: FastAPI service for ingestion, extraction, IR, review state, and export.
- `packages/contracts`: JSON Schema/OpenAPI-derived shared contracts.
- `infra`: Docker Compose and production deployment examples.
- `docs`: architecture, threat model, decisions, operations, and provider extension guides.

## v0.2 hosted profile

The public beta profile uses only services with a $0 launch tier:

- Cloudflare Pages serves the statically exported Next.js application.
- Supabase Free provides Auth, PostgreSQL, and a private Storage bucket.
- Render Free runs one bounded FastAPI/Tesseract web service and its leased job worker.

The hosted profile is intentionally single-instance and cold-start tolerant. Source files,
projects, revisions, jobs, quotas, and cached exports must survive a Render restart. No local
Render filesystem path is authoritative. If a free quota is exhausted, the service must reject
new work or pause; operators must not be required to enable usage-based billing.

Hosted requests use Supabase access tokens, exact-origin CORS checks, owner-scoped repository
queries, private object keys, revision limits, storage quotas, and a durable leased job queue.
Cross-user resource probes return the same not-found response as nonexistent IDs.

## Definition of a complete vertical slice

- A user can run the stack locally without an API key.
- A sample or uploaded document can become a persisted project.
- Native PDF text and image OCR routes are implemented.
- The review screen exposes confidence/warnings and accepts corrections.
- At least three distinct built-in handwriting personas render on A4.
- Preview and downloadable PDF use the same canonical content and seed.
- Tests cover extraction, validation, state transitions, rendering, API contracts, and the main UI path.
- The repository includes `.env.example`, one-command startup, CI, security notes, and a troubleshooting guide.
