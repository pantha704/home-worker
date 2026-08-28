# Homeworker v0.2.0 — gap and issue inventory

Status: runnable local-first product slice; public hosted acceptance is not yet proven.

## Product boundaries (not defects)

- Licensed generic personas only (Caveat, Patrick Hand, Kalam). No real-person clone, signature path, identity-document rendering, or automatic schoolwork submission.
- OCR is uncertain evidence. Review is required and unconfirmed output remains visibly drafted.
- Bundled renderer fonts are Latin-script oriented. Unsupported glyphs fail visibly with `UNSUPPORTED_RENDER_GLYPHS`; the UTF-8 companion preserves the reviewed text.

## Closed release blockers

| ID | Resolution |
|---|---|
| C1 | Source is `AGPL-3.0-only`, matching the PyMuPDF binary path; LICENSE, NOTICE, terms, privacy, and third-party notices are present. |
| C2 | Create supports `Idempotency-Key`: exact replay returns the original project and a mismatched payload returns `409`. |
| C3 | Per-page review now shows source evidence beside editable text, supports navigation/swipe, and selectively retries only marked pages. |
| C4 | Finalize provides page preview plus persona, paper, ink, margin, spacing, size, and seed controls. |
| C5 | Handwriting variation uses correlated line slant/baseline movement rather than independent per-glyph shaking. |
| C6 | Main-branch CI, browser smoke, container smoke, vulnerability, dependency, secret, and configuration checks pass. |

## Blockers before any public invitation

| ID | Issue | Required proof |
|---|---|---|
| H1 | Hosted stack has not been deployed and accepted live. | Deploy Cloudflare Pages + Render + Supabase using `docs/free-public-deployment.md`. |
| H2 | Cross-user isolation is tested locally but not proven against two real hosted accounts. | Account B receives the same `404` for account A's project as for a random ID. |
| H3 | Vendor auth/network configuration is unproven. | Magic-link delivery, JWKS, HTTPS, exact CORS/CSP and redirect URLs verified live. |
| H4 | Restart/retention/deletion behavior is not proven on the hosted vendors. | Restart during a leased job, then prove one completion; verify 14-day expiry and deletion-outbox drain. |
| H5 | Free Render runs request API and OCR/PDF work in one service and may sleep or hit resource ceilings. | Keep beta invite-only; do not claim an availability SLO. Split execution before meaningful traffic. |

## Required before meaningful traffic

| ID | Remaining hardening |
|---|---|
| S1 | Isolate API from OCR/PDF worker with durable external leasing and no-egress/CPU/RAM/tmp/process limits. |
| S2 | Add edge WAF/rate limiting; application quotas remain the last line of defense. |
| S3 | Add privacy-safe telemetry and alerts for readiness, queue age, lease steals, OCR/export p95, OOM/crashes, storage, expiry, and deletion backlog. |
| S4 | Configure encrypted backups and execute restore/rollback drills against the documented RPO/RTO. |
| S5 | Expand the rights-cleared adversarial/fidelity corpus: malformed/polyglot/bomb files, OCR prompt text, XSS, IDOR, multilingual, math/tables, accessibility, clipping, and physical A4. |
| S6 | Add signed manifests, SBOM generation, pinned production image digests, and explicit dependency-audit gates. |

## Proposed post-v0.2.0 direction

The reviewed browser-local architecture is documented in `docs/local-first-production-architecture.md`. Its first narrow proof is implemented: one-page text-layer PDF parsing in a dedicated worker, OPFS content-addressed objects, IndexedDB immutable revisions, expected-revision conflict checks, Web Locks, quota/persistence gates, local A4 PDF generation, and digest-verified `.homeworker` export/import. A real Chrome acceptance test proves reopen/edit/export with no `/v1/` document traffic. Browser OCR, multi-page processing, source-page raster review, full renderer parity, cross-browser acceptance, migration/rollback, cleanup, and assisted fallback remain open gates.

## Evidence and claim limits

- Hosted auth, owner-scoped persistence, private storage, leased jobs, and deletion outbox exist in code and automated tests; that is not a substitute for live vendor acceptance.
- Compose hardening applies to the local stack, not automatically to Render.
- The documented 99.5% and latency objectives are operational targets, not measured claims for sleeping free-tier infrastructure.
- Release artifacts must be built from Git-tracked source only. `.gitnexus/`, agent scratch, ignored goals/issues, dependencies, caches, uploads, and runtime data are excluded.
