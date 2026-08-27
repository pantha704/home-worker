# Homeworker v0.2.0 — gap and issue inventory

Snapshot: `be3797a` (local). Status: complete product slice for **local + $0 beta**, not production public traffic.

## Product contract (not bugs)

- Licensed generic personas only (Caveat / Patrick Hand / Kalam). No real-person clone, no signature path, no auto-submit of schoolwork.
- OCR is uncertain evidence; review is required; draft watermark until confirm.
- Latin-script glyphs; other scripts fail closed (`UNSUPPORTED_RENDER_GLYPHS`).

## Blockers before any public invite

| ID | Issue | Severity |
|----|--------|----------|
| L1 | ~~Source license vs PyMuPDF AGPL~~ **Closed:** AGPL-3.0-only + NOTICE. | — |
| L5 | ~~Create not idempotent~~ **Closed:** `Idempotency-Key` replay `200`, mismatch `409`. | — |
| L2 | ~~No terms/privacy~~ **Closed:** `docs/terms.md`, `docs/privacy.md` (not child/school-directed). | — |
| L3 | Live two-account IDOR, magic-link/TLS, restart recovery, 14-day expiry, and outbox drain are documented but not proven on a live hosted stack in this tree. | Blocker |
| L4 | Untracked leftover work PDFs exist under `services/api/data/work/projects/*` (~1.1 MB). `.gitignore` covers `data/` but release zips must still exclude them. | High |
| L6 | OCR/PDF share the API process. Free Render sleep (~1 min cold start) will kill OCR jobs. Filesystem on free Render is ephemeral. | High |

## Must-change for real load

| ID | Issue |
|----|--------|
| S1 | Split API vs worker. Isolate PyMuPDF / Tesseract / fonts (no-egress, CPU/RAM/tmp caps). |
| S2 | External queue + idempotency before horizontal scale. |
| S3 | Edge rate-limit / WAF; app quotas are last line only. |
| S4 | Observability: queue age, lease steal, OCR p95, OOM, `/ready`, disk. **No document text in logs.** |
| S5 | Encrypted backups of Supabase + restore drill (docs SLO: RPO 24h / RTO 4h) — not executed here. |
| S6 | Adversarial corpus: zip bombs, polyglots, XSS-in-OCR, IDOR. |
| S7 | Signed manifests (today: SHA-256 hash only), pinned image digests, SBOM, `pip-audit` / `pnpm audit`. |
| S8 | Renderer still uses **per-glyph independent jitter**, not correlated irregularity (ADR-0003). Reads as “font with the shakes.” |

## Honesty vs claims

- Hosted auth: `SupabaseTokenVerifier` + exact-origin CORS — code present; live two-tenant proof not in this deploy.
- Leased jobs survive restart — unit/integration only unless Render is actually bounced.
- Compose hardening (non-root, read-only FS, 2 CPU / 4 GiB) is local-stack, not hosted.
- SLOs (99.5% API, p95 extract 60s typed / 5 min OCR / 30s export) are meaningless on free sleep hardware.

## Git / publish hygiene

- Do not ship `.gitnexus/`, `.claude/`, or generated `CLAUDE.md`.
- Do not ship `.env` (examples only).
- Existing GitHub repo: `pantha704/home-worker` (public, empty-ish Aug 3). This tree is the first real v0.2.0 code push.
