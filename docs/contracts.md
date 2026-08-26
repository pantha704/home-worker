# Canonical IR and API contract

Status: normative v0.2.0 contract  
Last reviewed: 2026-08-03

The JSON Schema/OpenAPI artifacts in `packages/contracts` are authoritative when present. This document states invariants shared by local synchronous processing and hosted durable-job processing.

## Canonical document IR

The IR separates extracted evidence from user-reviewed content and renderer choices.

```json
{
  "id": "generated-project-id",
  "filename": "display-only.pdf",
  "mimeType": "application/pdf",
  "sha256": "64-lowercase-hex-characters",
  "status": "needs_review",
  "revision": 1,
  "createdAt": "2026-07-15T00:00:00Z",
  "updatedAt": "2026-07-15T00:00:00Z",
  "pages": [{
    "number": 1,
    "widthPoints": 595.28,
    "heightPoints": 841.89,
    "blocks": [{
      "id": "stable-block-id",
      "kind": "paragraph",
      "text": "Extracted text awaiting review",
      "confidence": 0.98,
      "reviewed": false,
      "source": {
        "pageNumber": 1,
        "bbox": {"x": 72, "y": 80, "width": 448, "height": 40},
        "extractor": "native_pdf"
      },
      "warnings": []
    }]
  }],
  "settings": {
    "personaId": "scholar",
    "seed": 42,
    "inkColor": "#1D3557",
    "paperStyle": "ruled",
    "marginMm": 15,
    "lineSpacing": 1.25
  },
  "error": null
}
```

### Required invariants

- Identifiers, source SHA-256, media type, page geometry, timestamps, status, and revision are server-controlled. The external JSON is camelCase and rejects unknown fields.
- Page numbers are one-based. Coordinates are `x`, `y`, `width`, and `height` in PDF points from the normalized page's top-left. One point is 1/72 inch.
- Every content block has a stable opaque ID, kind, text, source page/box/extractor, confidence in `[0,1]`, reviewed flag, and warnings array.
- Editing `text` requires `expectedRevision`, atomically creates a stored historical revision, keeps the source box, marks the current extractor `manual`, sets `reviewed`, and adds `USER_CORRECTED`. `source.json` exposes the earliest completed extraction as immutable comparison evidence without mutating the current revision.
- Confidence is evidence about extraction, not factual certainty. User edits do not receive invented OCR confidence.
- Reading order is explicit through array order or a versioned ordering field. Renderers must not infer a different order silently.
- Unknown enum values and newer schema versions fail closed with a structured compatibility error.
- Renderer settings and persona metadata do not live inside source evidence.

Block kinds are `heading`, `paragraph`, `list_item`, `equation`, `table`, `figure`, and `unknown`. Unsupported structure becomes `unknown` where detected; a gold-corpus gate must verify it is not silently dropped.

## Resource model

| Resource | Meaning | Mutability |
|---|---|---|
| Project | User-owned workspace and lifecycle root | Metadata only |
| Source | Immutable uploaded bytes and digest | Immutable |
| Revision | Complete canonical IR snapshot | Immutable after commit |
| Persona | Built-in handwriting style and license label | Code/font release |
| Job | Durable hosted extraction task with lease/retry state | Server-controlled |
| Export | Digest-keyed PDF/text bound to an exact revision | Immutable cache entry |
| Manifest | Source/artifact digest and exact revision binding | Generated from immutable metadata |

Local mode uses the implicit owner `local`. Hosted mode derives a UUID owner only from a verified Supabase access token and applies it to every project, revision, job, artifact, rate counter, and object key.

## Expected HTTP surface

All product endpoints are under `/v1`; health endpoints are not versioned. Local create performs bounded extraction synchronously. Hosted create stores the source, commits a `processing` project plus durable job, and returns while a leased worker extracts it.

| Method and path | Purpose | Expected result |
|---|---|---|
| `GET /health` | Process liveness | `200` without touching OCR/providers |
| `GET /ready` | DB/schema/data-root readiness | `200` ready, `503` otherwise |
| `POST /v1/projects` | Stream one PDF/image and create project/job | `201` reviewable local project or hosted `processing` project |
| `GET /v1/projects` | List the authenticated owner's projects | `200` bounded list |
| `GET /v1/projects/{id}` | Fetch canonical review state | `200` project/revision or `404` |
| `DELETE /v1/projects/{id}?expectedRevision=N` | Delete project/history and enqueue private-object cleanup | `204`, `404`, or `409` stale |
| `PATCH /v1/projects/{id}/blocks/{block_id}` | Correct one block in a new logical revision | `200` updated project with edit metadata |
| `POST /v1/projects/{id}/confirm` | Confirm review is complete | `200` state transition, conflict if unresolved |
| `PATCH /v1/projects/{id}/settings` | Set persona/page/seed rendering settings | `200` validated settings |
| `GET /v1/personas` | List usable licensed personas | `200` list including license label |
| `GET /v1/projects/{id}/export.pdf` | Render/stream printable A4 PDF | `200 application/pdf` with safe disposition |
| `GET /v1/projects/{id}/companion.pdf` | Render/stream selectable typed PDF | `200 application/pdf`; not claimed as PDF/UA |
| `GET /v1/projects/{id}/companion.txt` | Stream exact reviewed reading-order text | `200 text/plain` |
| `GET /v1/projects/{id}/source.json` | Retrieve immutable completed extraction evidence | `200 ProjectDocument` |
| `GET /v1/projects/{id}/manifest.json` | Bind source and artifact SHA-256 to one revision/kind | `200 ArtifactManifest` |

The project list uses bounded `limit`/`offset` pagination. Download responses use a sanitized server-derived filename plus `Content-Disposition`; source filenames are display metadata only.

## Writes, concurrency, and retries

- Every patch/confirm/settings request and delete carries `expectedRevision`; a stale mutation returns `409 REVISION_CONFLICT` and creates no new revision/deletion.
- Create is not yet idempotent, so clients must not retry it automatically. A production asynchronous extension adds `Idempotency-Key` (opaque, maximum 128 bytes) before horizontal scaling.
- Clients may retry read-only requests after `408`, `429`, `502`, `503`, and `504` with exponential backoff and jitter. Writes require an explicit user action until idempotency is implemented.
- Confirm validates the current revision and the exact set of uncertain/warned block acknowledgements. Unknown or missing acknowledgements fail closed. Before confirmation the server returns only an inline PDF carrying `DRAFT - REVIEW REQUIRED`; reviewed artifacts use attachment disposition and exact-revision manifests.

Delete removes the owner-scoped project row and dependent revisions/jobs/artifacts in one transaction while writing exact private keys to a deletion outbox. Cleanup is idempotently retried; an unavailable object service never makes the deleted project visible again.

## Problem details

Errors use a stable request-correlated JSON envelope and never intentionally contain raw document text, host paths, stack traces, or provider secrets.

```json
{
  "error": {
    "code": "UPLOAD_TOO_LARGE",
    "message": "The file exceeds the configured upload limit.",
    "requestId": "request-id",
    "details": {"maxBytes": 26214400}
  }
}
```

Validation errors may add field pointers. Extraction warnings belong on blocks/project state, not in successful response error fields.

## API security assumptions

- The default Docker stack binds to loopback and intentionally has no remote authentication. It must not be exposed to a LAN or internet.
- Hosted mode requires HTTPS origins, asymmetric Supabase JWT verification, a non-anonymous authenticated role, and per-owner authorization on every project/artifact path.
- Hosted mutations require an exact allowed `Origin` and `X-Homeworker-Client: web`; bearer tokens are sent in headers, never artifact URLs.
- CORS is an exact allowlist. Credentials are never combined with wildcard origins.
- Upload and download endpoints set `X-Content-Type-Options: nosniff`; source content is never served inline as active HTML/SVG.
- Rate, concurrency, byte, page, pixel, and execution limits are enforced server-side.

## Compatibility policy

The current project schema is identified by the versioned file/package rather than an in-document `schemaVersion`. Removing fields, changing meaning/units/reading order, or weakening provenance requires a new major schema package and coordinated API/web release. Artifact manifests use `schemaVersion: "1.0"` and expose source/artifact digests plus the exact project revision.
