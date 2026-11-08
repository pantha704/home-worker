# Static browser-local preview

The `.github/workflows/static-preview.yml` workflow publishes the browser-local
build to GitHub Pages on every push to `main`.

URL: `https://<owner>.github.io/<repository>/`

## What it is

A static export of the same UI with `NEXT_PUBLIC_STATIC_EXPORT=1`, so every
document stays in the browser (OPFS + IndexedDB) and no `/v1/` request is made.
It supports text-layer PDF, PNG, and JPEG input, the same review flow, and the
same A4 export as the browser-local profile.

## What it is not

- It is not the hosted beta. There is no API, no account, no database, and no
  storage on the server.
- It has the browser-local limits: no FastAPI source-image evidence, scanned PDF
  OCR is capped at 10 pages, and Safari is not proven.
- GitHub Pages cannot send custom response headers, so the CSP and
  `X-Frame-Options` equivalents written to `_headers` apply only on Cloudflare
  Pages. Treat the Pages deployment as a convenience preview, not as the
  hardened host. Use `docs/free-public-deployment.md` for the CSP-carrying host.

## Path prefix

GitHub Pages serves project sites under `/<repository>`, so the workflow sets
`NEXT_PUBLIC_BASE_PATH=/<repository>`. `apps/web/next.config.ts` maps that to
`basePath` and `assetPrefix`. Leave the variable unset for root-origin hosts and
local development.
