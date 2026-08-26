# Homeworker API

A local-first FastAPI service that extracts source text, preserves block-level provenance and
confidence, records every review revision, and renders deterministic A4 PDFs. The default path
uses SQLite, local files, PyMuPDF, Tesseract, and ReportLab. It needs no account, paid provider,
or API key. Hosted mode uses Supabase Free for authentication, PostgreSQL, and private object
storage while keeping the same fidelity contract.

## Run locally

Requirements: Python 3.12+, `uv`, and Tesseract for PNG/JPEG or scanned-PDF OCR.

~~~bash
cd services/api
uv sync --frozen --extra dev
uv run uvicorn app.main:app --reload
~~~

On Debian/Ubuntu, install OCR with `sudo apt install tesseract-ocr tesseract-ocr-eng`. Native-text
PDFs do not invoke OCR. When a scanned page needs OCR and Tesseract is absent, the API returns
`OCR_ENGINE_UNAVAILABLE` with an installation action instead of silently returning empty text.
Set `INK_OCR_LANGUAGES` to installed Tesseract language codes joined by `+` (for example,
`eng+hin`). The default container installs English only; extra language packs remain free but
must be installed explicitly.

Copy `.env.example` to `.env` or export its variables. The defaults store SQLite at
`data/homeworker.db` and source files under `data/storage/projects/<generated-uuid>/source.ext`.
User filenames are display metadata only and never become storage paths.

The default `ANALYZER_PROVIDER=rules` is deterministic and makes no network calls. Optionally set
`ANALYZER_PROVIDER=ollama` with a running local Ollama 0.32.0 server and
`OLLAMA_MODEL=qwen3:4b`. The adapter requests schema-constrained JSON, treats all document text as
untrusted data, can change block kinds only, and retains the rule result with a visible
`LOCAL_ANALYZER_FALLBACK` warning on any error. It never pulls a model automatically.

## Canonical HTTP contract

All public JSON is camelCase. Mutation responses return the complete updated project. Every
mutation uses optimistic concurrency; a stale `expectedRevision` returns HTTP 409 with
`REVISION_CONFLICT`.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | — | process liveness |
| GET | `/ready` | — | database and writable-storage readiness |
| POST | `/v1/projects` | multipart field `file` (PDF/PNG/JPEG) | `201 ProjectDocument` |
| GET | `/v1/projects?limit=25&offset=0` | — | `{items, total}` summaries |
| GET | `/v1/projects/{id}` | — | `ProjectDocument` |
| DELETE | `/v1/projects/{id}?expectedRevision=N` | — | `204 No Content` |
| PATCH | `/v1/projects/{id}/blocks/{blockId}` | `{text, expectedRevision}` | updated project |
| POST | `/v1/projects/{id}/confirm` | `{expectedRevision}` | reviewed, `ready` project |
| PATCH | `/v1/projects/{id}/settings` | flat partial settings + `expectedRevision` | updated project |
| GET | `/v1/personas` | — | three built-in OFL personas |
| GET | `/v1/projects/{id}/export.pdf` | — | deterministic A4 handwriting-style PDF |
| GET | `/v1/projects/{id}/companion.pdf` | — | selectable-text A4 companion PDF |
| GET | `/v1/projects/{id}/companion.txt` | — | Unicode-preserving UTF-8 companion |
| GET | `/v1/projects/{id}/source.json` | — | immutable original extraction evidence |
| GET | `/v1/projects/{id}/manifest.json` | revision + artifact kind | artifact/source SHA-256 manifest |

Settings patch example:

~~~json
{
  "expectedRevision": 3,
  "personaId": "casual",
  "seed": 42,
  "inkColor": "#243B6B",
  "paperStyle": "grid",
  "marginMm": 15,
  "lineSpacing": 1.25
}
~~~

Blocks carry `{id, kind, text, confidence, reviewed, source, warnings}`. `source` contains the
source page, points-based bounding box, and extractor. A manual correction keeps its source box,
changes the extractor to `manual`, records `USER_CORRECTED`, and creates an immutable database
revision. Confirmation is explicit; extraction never marks content reviewed.

Deletion checks the expected revision, removes the project and its dependent rows in one database
transaction, and places every private object key in a durable deletion outbox. Cleanup is retried
without restoring browser-visible project state.

Errors are stable and request-correlated:

~~~json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The project changed since it was loaded. Refresh and retry.",
    "requestId": "...",
    "details": {"expectedRevision": 1, "currentRevision": 2}
  }
}
~~~

## Validation and rendering behavior

Uploads are streamed in bounded chunks. The API checks byte size, declared MIME, magic bytes,
image decoding/pixel count, PDF encryption, page count, page geometry, OCR raster size, and
extracted character count. Password-protected PDFs are rejected. Display names are sanitized,
and storage names are generated.

The PDF export is rendered from `(project ID, revision, persona, seed)` with exact ISO A4
geometry and print-safe margins. The three bundled persona fonts are OFL-licensed and embedded;
per-persona spacing, baseline, rotation, and size variation is seeded and reproducible. The
handwritten preview carries `DRAFT - REVIEW REQUIRED` on every sheet until the explicit confirm
transition changes the project to `ready`. The
typed PDF contains real selectable text in reading order, but ReportLab output is not claimed to
be PDF/UA. Use `companion.txt` when full Unicode preservation or an assistive-technology fallback
is required.
The initial persona set is Latin-focused. If neither the selected persona nor the embedded typed
fallback covers a reviewed code point, PDF export fails visibly with
`UNSUPPORTED_RENDER_GLYPHS`; `companion.txt` still preserves the exact Unicode text. This avoids
silently substituting missing-glyph boxes while broader OFL script coverage is added.

## Quality commands

~~~bash
uv run ruff check app tests
uv run mypy app
uv run pytest --cov=app --cov-report=term-missing
~~~

Local mode extracts synchronously and uses SQLite WAL plus local objects. Hosted mode stores the
source first, commits an owner-scoped queued project, and lets a leased in-process worker perform
bounded extraction. Jobs, revisions, sources, and artifacts survive a Render restart in Supabase;
the Render filesystem is temporary and never authoritative. The free profile remains intentionally
single-instance.

The canonical locked, non-root API container is `infra/docker/Dockerfile.api`; Docker Compose and
CI both build that file from the repository root.
