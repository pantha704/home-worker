# Troubleshooting

Start with the exact failing service and request ID. Logs should contain metadata/error codes, not document text.

## Stack does not become healthy

```bash
cd infra
docker compose config --quiet
docker compose ps
docker compose logs --tail=200 api web
```

- `api` live but not ready: check named-volume free space/ownership and the SQLite/storage error. Do not chmod arbitrary host paths or delete the database.
- `web` unhealthy: request `http://localhost:3000/`; verify the standalone image was rebuilt after frontend changes.
- Port already allocated: choose unused `INK_WEB_PORT`/`INK_API_PORT`; also update `NEXT_PUBLIC_API_BASE_URL` and `INK_CORS_ORIGINS`, then rebuild web because its public API URL is build-time configuration.
- Old local images: run `docker compose build --no-cache api web` only after recording why normal cache invalidation failed.

## Browser says the API is unavailable

Check `http://localhost:8000/health` and `/ready` directly. The browser must be able to resolve `NEXT_PUBLIC_API_BASE_URL`; `http://api:8000` works inside Docker but not in the host browser. The browser origin must exactly match `INK_CORS_ORIGINS` including scheme and port.

Do not fix a CORS error with `*`, disable browser security, or publish the no-auth API on all interfaces.

In hosted mode, also verify the Cloudflare origin exactly matches `INK_CORS_ORIGINS`, Supabase Auth Site/Redirect URLs match the same `pages.dev` origin, and all four browser variables were present during the static build. A Render cold start can take about a minute; retry bounded reads rather than repeatedly uploading the same file.

## Upload is rejected

Use the structured error code:

- `UNSUPPORTED_MEDIA_TYPE` / `MIME_MISMATCH`: export a real PDF, PNG, or JPEG; renaming an extension is insufficient.
- `UPLOAD_TOO_LARGE`, `PDF_PAGE_LIMIT_EXCEEDED`, `IMAGE_PIXEL_LIMIT_EXCEEDED`: split/reduce the document or deliberately change the operator limit after a resource review.
- `ENCRYPTED_PDF`: create an unlocked copy that you are authorized to process.
- `INVALID_PDF` / `INVALID_IMAGE`: re-export from a trusted reader; do not repeatedly feed a parser-crashing file.

## Scanned/handwritten page has no or poor text

The API image includes English Tesseract. `INK_OCR_LANGUAGES=eng` uses only installed language packs; adding a language code without installing its pack in the image will fail. Rebuild with reviewed Debian Tesseract language packages, then add a rights-cleared gold fixture for that script.

Low confidence is expected for some handwriting, equations, tables, mixed scripts, rotation, or noise. Correct it in review. Do not raise confidence, drop the block, or use an analyzer to invent missing text.

## Ollama adds a fallback warning

`LOCAL_ANALYZER_FALLBACK` means deterministic rule output was retained. Verify all of:

```bash
docker compose --profile ollama ps
docker compose --profile ollama exec ollama ollama list
docker compose --profile ollama logs --tail=100 ollama
```

The configured model must be downloaded explicitly and match `OLLAMA_MODEL`. The API uses `http://ollama:11434` inside Compose. Increase the 20-second timeout or 6-GiB memory ceiling only after measuring the local host. The analyzer may classify block kind only; it is not a text-recovery workaround.

## Export is unavailable or differs

Confirm review and refresh the current revision. A stale edit returns `REVISION_CONFLICT`; reload rather than overwriting. Record project ID/revision, source digest, settings, persona, seed, and renderer release.

Preview and download are the same generated endpoint. A visible difference for the same revision/settings is a release-blocking defect. Preserve the generated files without sharing private content, run the golden render tests, and do not “fix” it by hiding warnings.

The selectable typed PDF is not claimed to be PDF/UA. Use `companion.txt` as the full-Unicode/accessibility fallback.

## Backup or restore fails

The first backup may pull the pinned Alpine helper image. Restore requires the API stopped, the matching `.sha256`, and a new volume name. Never restore over the live volume. If checksum or path validation fails, treat the archive as unusable and investigate the backup source.

Docker is intentionally not given the host root or socket inside application containers. Do not weaken those mounts/capabilities to work around an unrelated filesystem issue.

## Project deletion reports cleanup required

Deletion removes browser-visible state first. In hosted mode, a temporary Supabase Storage failure leaves exact private keys in the durable deletion outbox for the worker to retry. Inspect metadata-only worker errors and Storage availability; do not recreate project rows or delete by display filename. Local mode cleanup remains constrained to generated owner/project object keys under the configured storage root.
