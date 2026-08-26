# Test strategy and SLOs

Status: release gates for the vertical slice  
Last reviewed: 2026-07-15

No test can prove “flawless.” The quality goal is measurable: do not silently mutate content, expose uncertainty, preserve provenance, reproduce reviewed output, and fail safely.

## Test layers

| Layer | Required coverage |
|---|---|
| Unit/property | Limits, MIME/signature checks, coordinate transforms, reading order, confidence propagation, path containment, edit/revision invariants, deterministic seed/layout, A4 math |
| Contract/schema | OpenAPI and JSON Schema examples; API compatibility; problem details; frontend generated types; unknown-version failure |
| Integration | SQLite/filesystem atomicity, upload→extract, native/OCR routing, revision conflicts/review save, render/download, revision-aware deletion and cleanup failure; future timed retention when added |
| Corpus | Rights-cleared typed, scanned, handwritten, mixed layout, math/table/figure, multilingual, rotated/noisy, blank/corrupt documents with block-level truth |
| Security | Malformed/polyglot/bomb files, XSS/prompt text, traversal/IDOR/CSRF/CORS, resource ceilings, container least privilege, dependency/secret scan |
| Visual/print | Preview and PDF from one layout plan; page images and structural PDF checks; font embedding; clipping/overflow; physical A4 test |
| End-to-end/accessibility | Keyboard-only upload/review/export, focus/errors, screen-reader labels, typed companion, supported browser flow |
| Operations | Backup/restore, schema migration, interrupted job, disk-full behavior, crash cleanup, rollback rehearsal |

## Gold corpus and evaluation

Corpus files must be owned/licensed for testing and stripped of unnecessary personal data. Maintain a manifest with source rights, language/layout traits, expected pages/blocks/text/regions, permitted tolerances, and reason for inclusion. Do not commit confidential user uploads as fixtures.

Measure at block and document level:

- character/word error rate by native text vs OCR and script/layout class;
- block detection/type, reading order, and source-region overlap;
- calibration: confidence buckets versus actual error and review rate;
- silent loss/addition/mutation count (release target zero on reviewed/gold content);
- user correction effort and time;
- render clipping, overflow, page count, and layout drift;
- preview/export content and layout-plan identity.

Any extractor/model upgrade runs the full frozen corpus. Report aggregate and worst slices; an average improvement cannot hide a regression for handwriting, math, tables, or a language.

## Release quality gates

1. Every accepted block has provenance, confidence, warning list, and source region.
2. Review edits create a new historical revision; the previous extracted snapshot remains unchanged. If `sourceText` is added to the public schema, it is immutable.
3. Text in the typed companion exactly matches reviewed canonical reading order, modulo documented line-ending/Unicode normalization.
4. Unknown/unsupported content remains represented with a warning; no silent block drop.
5. Same revision/persona/version/settings/seed yields the same layout plan and content-equivalent export.
6. PDF MediaBox is A4 (`595.28 × 841.89 pt`, tolerance `±0.02 pt`), fonts are embedded, and all marks stay inside configured print-safe bounds.
7. Hostile files fail within resource ceilings without partial commits, egress, or process escape.
8. Lint, formatting, type, unit/integration, contract, build, E2E smoke, accessibility, vulnerability, and secret checks pass.

## Initial SLOs

SLOs apply only to an operated hosted instance within supported file limits; a local user's hardware is reported against the same indicators but has no availability promise.

| Indicator | Initial objective | Measurement notes |
|---|---:|---|
| Monthly API availability | 99.5% | Excludes announced maintenance; readiness probes from the same region |
| Lightweight API latency | p95 ≤ 500 ms | Health/list/get/patch on a supported host; excludes extraction and downloads |
| Accepted extraction/export completion | ≥ 99% | Valid inputs within supported limits; no automatic write retry assumed |
| Typed 10-page extraction | p95 ≤ 60 s | Reference 4-core/8-GiB host, mostly native text |
| Scanned 10-page OCR | p95 ≤ 5 min | Reference host, English, 300-DPI-equivalent, within pixel limits |
| Export rendering | p95 ≤ 30 s | 20 reviewed A4 output pages on reference host |
| Reviewed text silent mutation/loss | 0 | Release-blocking invariant, not an error-budget metric |
| Preview/export layout-plan mismatch | 0 | Release-blocking invariant |
| Backup RPO / restore RTO | ≤ 24 h / ≤ 4 h | Requires daily successful backup and quarterly drill |

Performance tests record hardware, OS/container, document traits, cold/warm state, and versions. Do not advertise these as universal times.

## Error budget and alerts

A 99.5% monthly availability objective allows about 3 h 39 min of unplanned unavailability in a 30.5-day month. At 50% budget consumption, pause risky changes and fix the leading cause; at 100%, freeze non-reliability releases until recovery controls are demonstrated.

Alert on sustained readiness failure, crash/OOM loop, extraction/export error-code spikes, slow synchronous requests, disk reserve, backup age/failure, unexpected provider/egress use, and any fidelity invariant. Add queue/deletion-backlog alerts when those features exist. Never place document content in alert payloads.

## Definition of done for a change

- Purpose and threat impact reviewed.
- Contract/version/migration behavior explicit.
- Tests fail before the fix and pass after it where practical.
- Corpus/visual/accessibility/operations impact evaluated for relevant changes.
- Dependencies/licenses and privacy/log fields reviewed.
- Documentation and rollback notes updated.
