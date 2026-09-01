# Homeworker web

The web app has three explicit runtime profiles. `local-service` is the full local FastAPI/Tesseract workflow for PDF, PNG, and JPEG. `browser-preview` is the static/browser-local profile: text-layer PDFs, PNG, and JPEG with on-device Tesseract. OCR is uncertain evidence and does not yet match FastAPI source-image review, all personas, or multi-page scans. `hosted` is an experimental invite-only beta that requires live acceptance before use beyond testers.

No paid service or API key is required for full local mode. Hosted mode statically exports the site for Cloudflare Pages Free and uses Supabase Free magic-link authentication before calling the owner-scoped API.

## Run locally

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Open <http://localhost:3000>. The API defaults to <http://localhost:8000>.

Native development defaults to `NEXT_PUBLIC_RUNTIME_MODE=local-service`. A static Cloudflare build uses `browser-preview` unless the explicitly configured hosted build is selected.

`NEXT_PUBLIC_API_BASE_URL` is a public browser setting, not a secret. Set it before `next build` when the API is hosted elsewhere:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

For the free hosted build, copy `.env.hosted.example`, enter only the public API/Supabase values, and run:

```bash
pnpm --filter @homeworker/web build:hosted
```

This produces `apps/web/out` and a Cloudflare `_headers` file with exact HTTPS API and Supabase origins. Never put a database URL or `SUPABASE_SECRET_KEY` in a `NEXT_PUBLIC_*` variable.

## Quality commands

```bash
pnpm --filter @homeworker/web lint
pnpm --filter @homeworker/web typecheck
pnpm --filter @homeworker/web test
pnpm --filter @homeworker/web build
pnpm --filter @homeworker/web test:e2e
```

The Playwright suite starts the Next.js dev server and intercepts API calls, so its smoke path does not require a running backend. Install its browser once with `pnpm --filter @homeworker/web exec playwright install chromium`.

## API assumptions

The client uses the canonical camelCase contracts in `@homeworker/contracts`:

- `POST /v1/projects` with multipart field `file`
- `GET /v1/projects/{id}`; processing projects are polled with an abortable request
- `PATCH /v1/projects/{id}/blocks/{block_id}` with `text` and `expectedRevision`
- `POST /v1/projects/{id}/blocks/{block_id}/review` with `expectedRevision` for explicit approval
- `POST /v1/projects/{id}/confirm` with `expectedRevision`; persisted block reviews are authoritative
- `PATCH /v1/projects/{id}/settings` with flat partial settings and `expectedRevision`
- `GET /v1/personas`
- `GET /v1/projects/{id}/export.pdf`
- `GET /v1/projects/{id}/companion.pdf`
- `GET /v1/projects/{id}/companion.txt`
- `GET /v1/projects/{id}/source.json`
- `GET /v1/projects/{id}/manifest.json?revision=N&kind=...`
- `DELETE /v1/projects/{id}?expectedRevision=N` after explicit confirmation

Errors follow `{ error: { code, message, requestId, details? } }`. A `409` reloads the latest revision and asks the user to recheck their change.

## Safety and fidelity behavior

- Final handwritten and companion downloads have no `href` until `project.status === "ready"`.
- A draft preview may render during review, but is explicitly labelled as a draft.
- Low-confidence or warned blocks require a user acknowledgement or correction before project-level confirmation is enabled.
- Text corrections are explicit saves; cancel never mutates canonical text.
- The UI offers only the three redistributable built-in personas. It has no signature or handwriting-cloning flow.
- Companion PDF is labelled as selectable typed text, not as verified PDF/UA. Plain text is the accessible fallback.
- Hosted downloads are fetched with the current bearer token and opened from short-lived in-browser blobs; access tokens never appear in artifact URLs.

## Container

From the repository root:

```bash
docker build -f infra/docker/Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 \
  -t homeworker-web .
docker run --rm -p 3000:3000 homeworker-web
```

The runtime image is unprivileged and uses the pinned Node 24.18.0 LTS baseline.

## Version note

Next.js, React, Vite, Vitest, Playwright, Testing Library, and their type packages use the audited current stable versions recorded in `package.json`. ESLint remains pinned to 9.39.1 because the React lint plugin bundled by `eslint-config-next@16.2.11` is not compatible with ESLint 10's rule-context API. TypeScript remains on 5.9.3 for the same tested Next.js lint/parser compatibility window.
