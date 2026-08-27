# Zero-cost public beta deployment

This profile starts at $0 and does not require a custom domain or a paid API:

- Cloudflare Pages Free serves the static Next.js application.
- Render Free runs one FastAPI/Tesseract service and its leased in-process worker.
- Supabase Free provides magic-link Auth, PostgreSQL, and private Storage.

Free plans can pause, cold-start, or change their limits. Homeworker sets its own smaller quotas and never needs a card-backed overage setting. When a limit is reached, reject or pause new work; do not upgrade automatically.

## 0. Legal gate before public launch

The project is licensed **AGPL-3.0-only** because it links PyMuPDF. Serving a modified network copy requires offering corresponding source. See `LICENSE`, `NOTICE`, and `docs/terms.md`.

## 1. Create Supabase Free

1. Create a Free project at <https://database.new>. Do not enable a paid plan.
2. In **Authentication → URL Configuration**, set the Site URL to the final `https://YOUR_PROJECT.pages.dev` URL and add the same URL to Redirect URLs.
3. In **Authentication → Providers → Email**, keep email enabled. Homeworker uses password-free magic links; Google OAuth is optional and not required.
4. Rotate the project to an asymmetric JWT signing key if it still uses the legacy shared JWT secret. The API verifies the project's JWKS endpoint.
5. From this repository, link and apply the reviewed migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

The migration creates the private `homeworker` schema, durable jobs, revisions, quotas, deletion outbox, and a non-public `homeworker-private` bucket. Browser roles receive no direct table or bucket policy. Only the owner-scoped API uses the server secret. The Storage adapter sends a modern `sb_secret_...` key only in Supabase's `apikey` header; it never exposes or treats that opaque key as a user bearer JWT.

From **Connect**, copy the shared-pooler **session mode** connection string on port 5432 and change its scheme to `postgresql+psycopg://`. URL-encode special characters in the password. Do not use the direct IPv6-only URL on a host that lacks IPv6, and do not use transaction mode with prepared statements.

## 2. Create the Render Free API

1. Connect the repository in Render and create a Blueprint from `render.yaml`.
2. Confirm the service plan says **Free** and that no persistent disk or paid database is attached.
3. Enter the values marked `sync: false`, using `infra/.env.hosted.example` as the map:
   - `INK_DATABASE_URL`: Supabase session-pooler URL.
   - `INK_CORS_ORIGINS`: final Cloudflare Pages HTTPS origin only.
   - `SUPABASE_URL`, publishable key, and secret key from Supabase.
4. Deploy, then verify `https://YOUR_API.onrender.com/health` and `/ready`.

Render's filesystem is intentionally temporary. All authoritative documents, jobs, revisions, and cached exports live in Supabase. A free Render service sleeps when idle; the first request after sleep can take about a minute. The browser keeps polling a queued project after the API wakes.

## 3. Create Cloudflare Pages Free

1. In Cloudflare Pages, import the repository.
2. Use `/` as the root directory, `pnpm --filter @homeworker/web build:hosted` as the build command, and `apps/web/out` as the output directory.
3. Set the four public variables from `apps/web/.env.hosted.example`. Never place `SUPABASE_SECRET_KEY` or a database URL in a `NEXT_PUBLIC_*` variable.
4. Deploy once, then copy the final `pages.dev` origin into Supabase Auth's Site/Redirect URLs and Render's `INK_CORS_ORIGINS`. Redeploy Render after that edit.

The hosted build generates Cloudflare `_headers` with the exact API and Supabase origins. It also fails if either is not HTTPS.

## 4. Acceptance check

Use two different email accounts:

1. Sign in as account A, upload the bundled typed fixture, wait for extraction, review, confirm, and download all artifacts plus the manifest.
2. Confirm the manifest SHA-256 equals the downloaded PDF SHA-256.
3. Sign in as account B and confirm account A's project URL returns the same not-found result as a random ID.
4. Restart the Render service while a project is queued; after restart it must finish once and create revision 2.
5. Delete a project and verify it disappears immediately. Temporary Storage deletion failures remain in the durable deletion outbox for retry.
6. Confirm no secret appears in the Cloudflare build output, browser network responses, repository, or logs.

Do not call the beta publicly ready until this live-service check passes. Local automated tests cannot prove external TLS, email delivery, vendor dashboard settings, or free-plan availability.

## Free ceilings and scaling trigger

The application allows 20 active projects and 100 MiB of stored source/artifacts per account, 10 MiB per upload, 30 pages, 60 revisions, and 14-day retention. These are deliberately below Supabase's project-wide Free allowance. Monitor the Supabase and Render dashboards. When real usage approaches the shared plan limits, first reduce retention or invite volume; only choose a paid scale plan after measured demand justifies it.

Official plan references: <https://supabase.com/pricing>, <https://render.com/docs/free>, and <https://developers.cloudflare.com/pages/platform/limits/>.
