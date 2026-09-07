# Homeworker implementation tracking

Baseline commit: `d5ed91cd3fd68b405dac82f4a5952bcccc5015f6` (`main`)

Inspected 2026-09-07 against current `main`. Frontend vitest at baseline: 11 files, 72 tests passed.

Modes present (not replaced):

- Local service: FastAPI + Tesseract via Compose (`services/api`)
- Browser preview: OPFS/IndexedDB + worker (`apps/web/lib/browser-local.ts`)
- Hosted: fail-closed config + Supabase/Render code paths; live vendor drills **BLOCKED** (no owner secrets on this machine)

Do not count existing capabilities as new work.

| Requirement | Existing implementation | Missing work | Regression test | Status |
| --- | --- | --- | --- | --- |
| A1 Carry page text through worker protocol | Worker sent `text`; `requestLocalWorker` dropped it | Forward `text`; serialize/await progress before result or cancel | `browser-local.test.ts` progress + checkpoint path | VERIFIED |
| A1 Persist after each completed page | Checkpoints existed; blank pages skipped; writes batched after worker | Persist empty pages; await each checkpoint write | cancel after page 2 of 5 including blank | VERIFIED |
| A1 Mid-document PDF progress | `extractTextPages` had `onPage`; worker posted all PDF progress after extract+OCR batch | Worker posts after each page, OCR empty pages inline | worker loop; mocked process path | VERIFIED (unit). Real 5-page PDF worker e2e not re-run |
| A1 Resume, version, expiry, out-of-order | Resume from `pages.length+1` | Bind `extractionVersion`; 24h TTL; reject gaps | incompatible + expired tests | VERIFIED |
| A2 Shared persist lock / inflight objects | Distinct locks; sweep after create; objects before metadata | One `homeworker:persist` lock; OCR/render outside it; inflight digests; cleanup errors do not fail create; NotFound-only delete swallow | inflight sweep + persist lock + cleanup error | VERIFIED (jsdom). Real two-tab Playwright **not run** |
| A3 Archive size/type/hash/policy | Digest check + mime allowlist; read whole File first | Size gate before read; sniff source; decoded size; backup filename stem | archive tests | VERIFIED |
| B1 Review semantics | Hosted explicit block review; confirm ignores acknowledgement lists | Save all page drafts before confirm; browser preview labelled unverified; dirty downloads blocked | review-workspace + local-review tests | VERIFIED (unit). Visual/a11y not re-run |
| B2 Rendering fidelity | Server fallback glyphs + overflow tests; browser overflow tests | Browser renderer fails closed on missing glyphs | local-engine ₹ test; existing API glyph tests | VERIFIED (unit). Full persona visual inspection **not run** |
| C1 PDF structure policy | 1 MiB keyword scan | Parsed-structure inspection | Phase C | NOT STARTED |
| C2 Resource bounds | Upload/page caps in browser and API | Isolated parse process on real host | Phase C | NOT STARTED |
| D Hosted quotas/leases | Code + unit tests | Real PostgreSQL concurrency | BLOCKED without hosted DB | NOT STARTED |
| E Auth/privacy/ops | Code + unit tests | Two live accounts, backups | BLOCKED without vendor access | NOT STARTED |
| F Scope/UX/Safari | Chrome+Firefox e2e | Safari/iOS, listing/deletion UX, OCR benchmark | Safari BLOCKED on Linux | NOT STARTED |
| G Release/live beta | CI on GitHub | Owner branch protection, live drills, invite budget | BLOCKED pending owner | NOT STARTED |

Statuses: `NOT STARTED`, `IN PROGRESS`, `VERIFIED`, `BLOCKED`.
