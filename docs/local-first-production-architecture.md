# Local-first production architecture

Status: proposed architecture decision for the post-v0.2.0 product

## Decision

Homeworker will be local-first, not cloud-storage-first.

- Source documents, page rasters, reviewed text, revisions, and exports stay on the user's device by default.
- Browser working files use the Origin Private File System (OPFS); transactional project metadata uses IndexedDB or an OPFS-backed database only after a compatibility spike proves it.
- A user-visible, versioned `.homeworker` project archive is the portable backup and interchange format.
- The File System Access API is an optional durable mirror where supported, never the only persistence path.
- CPU-heavy work runs in dedicated Web Workers using locally served, version-pinned WASM and model assets.
- Supabase is optional for identity, entitlement, minimal metadata, and assisted-job coordination. It does not receive document contents in local mode.
- A VPS worker is an explicit assisted-processing fallback. Assisted mode is never silently selected and uses short retention, strict quotas, isolated workers, and deletion verification.
- WebContainers are not part of the production architecture. They add compatibility and memory cost without solving persistence or long-running execution.

This design reduces operator storage and compute costs and improves privacy, but it does not make browser storage a backup or make browser execution continuously available.

## Non-negotiable product invariants

1. OCR is uncertain evidence; the user reviews source and extracted text before finalization.
2. Source bytes are immutable and content-addressed by SHA-256.
3. Revisions are immutable; mutations use expected-revision conflict checks.
4. Final output is deterministic for the same canonical IR, renderer version, font package, settings, and seed.
5. Licensed generic personas only. No real-person handwriting clone, signature path, identity-document rendering, or automatic submission.
6. Local mode sends no document bytes, OCR text, filenames, page images, thumbnails, or exports to the network.
7. Assisted mode requires a separate, informed user action that states what leaves the device and when deletion occurs.
8. A successful write means bytes were flushed and verified, not merely handed to an API.
9. Updates never migrate or delete the only copy of a project in place.
10. No availability, durability, or privacy claim is published before its acceptance test is measured in production.

## Trust boundaries

```text
Untrusted document
  -> validation worker
  -> immutable local source object
  -> PDF/image worker
  -> canonical IR revision
  -> human review
  -> deterministic render worker
  -> local export / user-selected folder

Optional assisted path:
Browser -> TLS API -> private object quarantine -> isolated no-egress worker
        -> reviewed-result object -> browser download -> deletion outbox -> verified purge
```

Trusted components are the signed application build, pinned worker/WASM/model/font assets, canonical schemas, and local project database. Documents, filenames, PDFs, images, extracted strings, metadata, browser extensions, third-party scripts, network responses, and assisted-worker inputs are untrusted.

OPFS is origin-private, not secret from same-origin code, browser extensions with sufficient privileges, malware, the local OS account, or an unlocked shared device. Hashing gives integrity, not confidentiality.

## Client storage model

### OPFS object store

Use immutable content-addressed objects:

```text
objects/<sha256-prefix>/<sha256>
projects/<project-id>/staging/<operation-id>/...
engines/<engine-version>/...
```

Never overwrite committed source, revision, or export objects. Write a new object, flush it, read back its byte count and digest, then transactionally point metadata at it. Orphaned objects are safe and removed by a later mark-and-sweep pass.

### Transactional metadata

Metadata contains project IDs, object digests, byte sizes, MIME types, schema/engine versions, page geometry, canonical IR revisions, review state, settings, job checkpoints, and retention state. Raw files do not belong in `localStorage`.

A single logical writer owns project mutation. Coordinate tabs with Web Locks where available and BroadcastChannel for status. A tested lease/heartbeat fallback must fail closed when locks are unavailable. Never use unsafe concurrent OPFS write handles.

### Persistence and quota

At onboarding and before a large import:

1. Call `navigator.storage.estimate()`.
2. Request `navigator.storage.persist()` after a user gesture and explain the outcome.
3. Estimate source + raster + OCR + export working space with a safety reserve.
4. Reject before import when the reserve cannot be maintained.
5. Surface exact usage and provide per-project cleanup.

Persistence permission can be denied. Clearing site data deletes OPFS and IndexedDB. Safari can proactively evict inactive best-effort origins. Therefore the UI must never label OPFS as a backup.

### Portable project archive

Every confirmed project can be exported as a versioned archive containing:

- `manifest.json` with format/schema/engine versions and object digests
- immutable source bytes
- canonical IR revisions and review decisions
- renderer settings and persona/font manifest
- generated artifacts selected by the user
- no credentials, tokens, telemetry identifiers, or absolute paths

Import validates path traversal, duplicate names, expansion ratio, total bytes, entry count, schema, signatures, and every digest before persistence. Import stages into a new project and commits only after complete validation.

Offer automatic mirroring to a user-selected directory only where File System Access is supported and permission remains granted. The cross-browser baseline remains explicit archive export/import.

### Optional local vault

Origin isolation is not encryption. A later vault mode may encrypt each project with authenticated encryption and a user passphrase. It must use a versioned, calibrated password KDF, unique salts/nonces, memory-only unlocked keys, explicit lock timeout, and no recovery claim. Storing a decryption key beside ciphertext does not protect against XSS and is forbidden as a security claim.

## Browser execution model

### Capability classes

- **Class A:** OPFS, dedicated workers, sufficient quota, WASM/SIMD, successful calibration. Full local processing.
- **Class B:** OPFS and workers but low memory/performance. Local processing with lower DPI/page limits and serial execution.
- **Class C:** missing required APIs, private mode, denied/insufficient quota, repeated worker crashes, or failed calibration. Review-only/import-export UI plus optional assisted processing.

Do not infer capability from user agent alone. Run a synthetic one-page calibration and record only local capability results. Avoid relying on `deviceMemory`, which is absent or coarse on some browsers.

### Processing pipeline

1. Validate extension, declared MIME, magic bytes, structure, byte/page/pixel/object limits before committed storage.
2. Compute source digest incrementally.
3. Prefer native PDF text extraction.
4. Rasterize and OCR only pages requiring it.
5. Commit one page checkpoint at a time.
6. Merge selective retry into a new revision only after whole-document limits pass.
7. Render previews incrementally.
8. Render the final PDF and companions, then verify manifest digests.

Workers communicate with typed messages carrying operation ID, project ID, revision, stage, progress, checkpoint, cancellation generation, and typed errors. Ignore late messages from cancelled or superseded generations.

A tab must remain open for long OCR/render operations. Service workers and background sync are not a long-running compute guarantee; browsers can terminate them. Closing the tab pauses work at the last committed page checkpoint. Reopening offers `Resume`, `Restart page`, or `Discard staged work`.

### PDF and OCR engines

The current Python implementation is not reusable directly in the browser:

| Current component | Browser decision |
|---|---|
| PyMuPDF native extraction/rasterization | Evaluate official MuPDF.js WASM first to preserve behavior; it is AGPL/commercial and remains compatible only while Homeworker stays AGPL-compliant. Compare against PDF.js under a rights-cleared corpus before selection. |
| pytesseract/Tesseract binary | Use a pinned, self-hosted Tesseract WASM worker only after accuracy, bounding-box, language-pack, memory, cancellation, and cold-cache tests. Tesseract.js does not parse PDFs, so PDF parsing remains separate. |
| Pillow preprocessing | Reimplement bounded transforms using browser image APIs or a reviewed WASM library; decode off-main-thread where available. |
| ReportLab renderer | Reimplement against a reviewed browser PDF library or keep final rendering assisted initially. Determinism and A4 golden parity are release gates. |
| SQLAlchemy repository | Replace local concerns with a transactional client repository; retain contracts and revision semantics. |
| FastAPI API | Retain for assisted processing and account/metadata operations only. |
| Pydantic/contracts | Keep one canonical JSON Schema and generate Python/TypeScript validators to prevent drift. |

All worker, WASM, language model, and font assets are self-hosted from immutable hashed paths. No runtime CDN execution. Maintain checksums, licenses, provenance, SBOM, and cache size budgets.

SharedArrayBuffer/threaded acceleration is optional. If enabled, COOP/COEP requirements and their effects on authentication popups, embeds, fonts, and analytics must pass a separate compatibility gate. The baseline remains single-worker-compatible.

## Security and privacy controls

### Same-origin compromise

Local-first moves the most valuable data into reach of any successful same-origin XSS or compromised dependency. Required controls:

- strict CSP with no `unsafe-eval` or remote scripts
- Trusted Types where supported
- no third-party analytics, chat widgets, tag managers, or ad scripts on the processing origin
- dependency lockfile, review, audit, SBOM, provenance, and pinned CI actions
- immutable hashed assets and release manifest verification
- sanitize all extracted text before DOM insertion; never render it as HTML
- isolate document parsing in workers and never treat WASM as a complete sandbox
- metadata-only errors and telemetry
- automatic clipboard avoidance and no content in URLs/history

Prefer a dedicated processing origin separate from marketing pages and third-party integrations.

### Malicious files and resource abuse

Reject or bound:

- malformed/polyglot/encrypted/unsupported PDFs
- embedded files, JavaScript/actions, launch commands, multimedia, and external references
- object/nesting/stream/expansion limits
- total pages, pixels, decoded bytes, OCR characters, IR blocks, output pages, and wall time
- image decompression bombs and pathological fonts

Terminate and recreate a worker after fatal parser errors, memory pressure, or a bounded number of jobs. Never continue from parser memory after a crash.

### Privacy modes

- **Local guest:** no account; no document network requests; local-only metadata.
- **Local account:** identity and minimal metadata may sync, but document content remains local.
- **Assisted:** explicit upload and processing consent per project; server can see plaintext while processing and must say so. Client-side encryption cannot be marketed as end-to-end if the server possesses the decryption key.
- **Future encrypted sync:** opaque client-encrypted envelopes only, with separate key/recovery design and metadata-leakage review.

Telemetry is opt-in or strictly necessary aggregate operations telemetry. Never include filenames, OCR text, thumbnails, source/export bytes, document-derived labels, URLs containing project IDs, or stable cross-device fingerprints.

## Minimal Supabase account plane

Supabase is an account/control plane, not the document system of record. Local guest mode requires no account. Supabase Auth owns credentials and sessions; Homeworker never stores passwords.

Server-owned records are deliberately small:

| Record | Purpose | Noise/privacy rule |
|---|---|---|
| `account_profiles` | account lifecycle, accepted policy versions, created/updated/deleted timestamps | no document or device fields |
| `billing_subscriptions` | provider references and authoritative subscription state | service-only; provider IDs are never returned to the browser |
| `account_entitlements` | safe current plan/features/assisted limits | browser receives only a bounded API projection |
| `usage_periods` | atomic assisted jobs/pages/bytes/seconds counters per billing period | assisted mode only; local work is not counted remotely |
| `account_login_daily` | successful/failed login aggregates and last success per UTC day | no row per token refresh; no permanent IP/user-agent history |
| `account_events` | sparse account/security lifecycle audit | allowlisted event types only; no generic analytics payload |
| `webhook_inbox` | idempotent payment/auth event processing | unique provider event ID; no full secret-bearing payload retention |
| `deletion_requests` | account deletion state and completion proof | one active request per account |

### Fail-safe authority rules

- Browser roles cannot insert, update, or delete authoritative account, subscription, entitlement, usage, webhook, or audit rows.
- All base tables are default-deny with forced RLS and no permissive client-write policy. A narrow server API returns only the user's safe account projection.
- Subscription state changes only from verified provider webhooks. The client can request checkout/cancellation but cannot declare success.
- Every external event has a provider-scoped unique ID. Duplicate delivery returns the original result and creates no duplicate event, entitlement, or usage change.
- Webhook handling uses one database transaction: register event, validate allowed transition, update subscription/entitlement, append one sparse audit event, then mark processed. A failure rolls back the whole transition.
- Reject stale provider events using provider event time/version while retaining their deduplicated receipt status for reconciliation.
- Usage is incremented only from a canonical assisted-job transition committed by the server. Values are non-negative, bounded, period-scoped, and updated atomically; client-reported counters are ignored.
- Entitlement checks and assisted-job admission happen in the same transaction or against a revision/version that is rechecked before accepting work.
- Account deletion first blocks new sessions/jobs, cancels queued work, marks document cleanup, and completes only after all server-owned rows/objects have reached verified terminal deletion states.
- Database migrations use expand/migrate/contract, are backward-compatible during rollout, and have a rehearsed restore path. Never guess a destructive downgrade.
- Supabase or account-plane failure never blocks opening, editing, exporting, or deleting an already-local project. Paid/assisted operations fail closed with a clear degraded-state message.

### No-noise event policy

Allowed durable account events are limited to material transitions such as account created, policy accepted, plan changed, subscription state changed, account suspended/restored, deletion requested, and deletion completed. Login activity is a daily aggregate, not an append-only event stream. Token refresh, page view, heartbeat, progress percentage, local page completion, local OCR timing, and UI clicks are not durable account events.

Operational metrics aggregate status/count/duration buckets without document IDs or user timelines. Repeated identical readiness or dependency failures are rate-limited and coalesced. Alerts fire on state transitions or sustained threshold breaches, not each retry. Every stored field and metric must have an owner, purpose, retention period, and deletion behavior; otherwise it is not collected.

Required tests include duplicate and out-of-order webhooks, concurrent quota admission, rollback after each transaction step, forged client plan/usage updates, cross-user reads, deleted/suspended accounts, Supabase outage, retention purge, and proof that local processing emits no account/usage row.

## Local job and revision state machines

Project:

```text
importing -> staged -> extracting -> review_required -> confirmed -> rendering -> ready
     |          |          |                |             |           |
     +------> failed_recoverable <-----------+-------------+-----------+
                    |                                             |
                 discarded                                      archived
```

Each transition commits expected prior state, operation generation, engine version, checkpoint, and an append-only sanitized event. A crash cannot change a confirmed revision. Recovery resumes only idempotent page work; ambiguous finalization verifies object digest/manifest before retrying.

## Assisted-processing architecture

Assisted mode uses a stateless API, transactional queue, private quarantine/object storage, and separate worker processes.

Job states:

```text
accepted -> queued -> leased -> processing -> result_committed -> delivered -> purge_pending -> purged
                           |          |
                           +-> retry_scheduled
                           +-> failed_terminal
                           +-> cancelled
```

Claims are atomic and leased. Every attempt has an ID, deadline, heartbeat, max attempts, and idempotency key. Results are content-addressed and committed before success. Stale leases retry only idempotent processing. Deletion uses an outbox and is not complete until database metadata and object absence are verified.

Workers run non-root with read-only root filesystems, bounded CPU/RAM/PIDs/tmp, no Docker socket, no cloud credentials beyond exact object/job scope, and no egress except necessary internal endpoints. Parser/OCR subprocesses get stricter limits and are recycled.

### Availability reality

One VPS is one failure domain. Docker restart policies do not provide zero downtime when the host, disk, network, kernel, Caddy, or power fails.

Initial beta can accept this with an honest availability target and local mode remaining usable from its cached application. Meaningful assisted-processing availability requires:

- at least two API instances across failure domains
- managed or replicated transactional state
- object storage independent of workers
- multiple leased workers or accepted queue delay
- load balancer health checks and connection draining
- backward-compatible expand/migrate/contract database changes
- immutable images, canary deployment, and tested rollback

The local processing mode should remain functional during Supabase or VPS outages after the application and required engines have been cached. Login, entitlement refresh, assisted jobs, and cross-device metadata may be unavailable; the UI must distinguish those from local project availability.

## Service-worker and application updates

- Version application shell, schemas, engines, models, and fonts independently.
- Never call `skipWaiting()` while a project operation is active.
- Notify the user that an update is ready; activate after all active operations checkpoint and tabs acknowledge.
- Keep old engine assets while any project or active tab references them.
- Database migration is copy-on-write into a new schema/store, validated, then switched by one small pointer transaction.
- On failed migration, keep the old application/data readable and offer archive export.
- Test mixed old/new tabs, offline update, interrupted install, corrupt cache, rollback, and storage pressure.

## Observability without document leakage

Local UI exposes its own diagnostics: capability class, storage usage/quota/persistence, engine versions, current stage/page, elapsed time, worker restarts, last checkpoint, and export verification. Diagnostics export is user-initiated and redacted.

Server metrics include request rates/status, auth failures, queue depth/age, leases and steals, attempts, stage durations, worker memory/CPU/OOM, object bytes/age, deletion backlog, dependency readiness, deploy version, and backup age/restore result. Logs use request/job/attempt IDs only.

Alert on sustained readiness failure, queue-age objective breach, repeated lease steals, worker crash loops, low disk/object capacity, purge deadline breach, backup staleness, and any isolation-test failure.

## Reliability objectives and claim limits

Absolute zero downtime and zero failure are impossible. Design targets must separate modes:

- **Local project durability:** no claim beyond the last verified archive/mirror. OPFS alone is not a backup.
- **Local operation recovery:** page-boundary recovery after tab/worker/browser termination; no confirmed revision corruption.
- **Local availability:** usable without backend after cached assets are present, subject to browser/device availability.
- **Assisted API availability:** define and measure after deployment; a single VPS cannot justify a high-availability claim.
- **Assisted job durability:** accepted jobs survive API/worker restarts; one logical result per idempotency key.
- **Deletion objective:** define a short normal TTL and a separately measured maximum purge deadline.

Every public SLO must have a measurement query, owner, alert, error budget, and incident response. Do not claim an SLO from synthetic tests alone.

## Cost and abuse controls

Local mode still incurs application/CDN bandwidth for the shell, WASM engines, OCR language models, and updates. Cache immutable assets and download language packs on demand with disclosed sizes.

Assisted mode requires per-account and per-device controls: maximum source bytes/pages/pixels, concurrent jobs, daily pages, retained bytes, job wall time, result TTL, and global emergency caps. Quota rejection occurs before upload where possible. Do not auto-enable paid vendor tiers or silently retain files.

Mode selection policy:

1. Try capability and quota checks.
2. Run a bounded local calibration.
3. Recommend local full mode when it passes.
4. Recommend reduced local mode for marginal devices.
5. Offer assisted mode only after repeated bounded local failure or explicit user choice.
6. Never upload automatically as a retry.

## Failure matrix

| Failure | Required behavior |
|---|---|
| Tab/browser closes | Last committed page survives; staged page is discarded/retried. |
| Worker crashes/OOMs | UI remains responsive; record sanitized failure; lower concurrency/DPI once; offer assisted mode after bounded retries. |
| Quota exceeded mid-write | Committed objects remain valid; staged object is orphaned and swept; prompt export/cleanup. |
| Site data cleared | Explain loss honestly; restore only from user archive/mirror. |
| Two tabs edit one project | One writer wins; second becomes read-only or receives a revision conflict. |
| App update during OCR | Defer activation, checkpoint, retain referenced engine, then update. |
| Corrupt OPFS object | Digest failure; quarantine reference; regenerate derived data or require source restore. |
| Supabase outage | Local projects continue; auth/sync/assisted controls show degraded state. |
| VPS/API outage | Local projects continue; accepted remote jobs remain queued if transactional state is available. |
| Assisted worker dies | Lease expires; idempotent job resumes from committed state. |
| Deletion provider outage | Project remains logically deleted; outbox retries exact keys; alert before deadline breach. |
| Malicious PDF | Bounded worker fails closed; no network access; no partial committed revision. |
| Dependency compromise | Revoke build/engine version, stop assisted jobs, publish clean signed build, preserve user data compatibility. |

## Production proof gates

### Gate 0 — architecture spike

- Prove OPFS/IndexedDB transactions and archive round-trip on current Chrome, Edge, Firefox, Safari, Android Chrome, and iOS Safari.
- Test normal and private modes, persistence denied/granted, quota exhaustion, storage pressure, and site-data clearing.
- Benchmark native PDF extraction, rasterization, OCR, review preview, and export on low/mid/high devices.
- Compare browser output with the current Python corpus; record accuracy and deterministic differences.
- Complete license review for every WASM, model, font, and PDF dependency.

### Gate 1 — storage kernel

- Red tests for partial writes, digest mismatch, orphan recovery, multi-tab races, stale locks, expected-revision conflicts, migrations, export/import bombs, and archive corruption.
- Fuzz manifest/archive parsers.
- Prove no document request leaves the browser in local mode using browser/network tests.

### Gate 2 — one-page vertical slice

- PDF/image import -> native text/OCR -> source/text review -> confirm -> deterministic A4 export entirely in one browser.
- Cancellation, checkpoint, resume, low memory, unsupported glyph, and offline reload tests.
- Visual and structural parity against rights-cleared golden fixtures.

### Gate 3 — full local product

- Multi-page selective retry, revisions, previews, companions, archive mirror, cleanup, accessibility, multilingual failure behavior, and diagnostics.
- Long-duration and repeated-job tests with bounded memory and no leaked workers/object URLs/handles.
- Service-worker mixed-version, migration interruption, and rollback drills.

### Gate 4 — assisted fallback

- Two-account IDOR, exact CORS/CSP, quotas, atomic leases, restart during each stage, duplicate delivery, cancellation, deletion outbox, TTL, backup/restore, parser isolation, and malicious corpus.
- Prove the browser never silently changes from local to assisted mode.

### Gate 5 — production rollout

- Canary by capability class and browser, not all users at once.
- Feature kill switches for each engine and assisted upload.
- Error budgets, capacity limits, on-call/incident procedures, restore drill, and rollback verified.
- Increase traffic only after measured success, latency, crash, recovery, data-loss, and support rates meet the approved thresholds.

## Migration plan from v0.2.0

1. Freeze existing API contracts and generate a canonical schema package.
2. Build the browser storage kernel and archive format without changing current hosted behavior.
3. Add capability detection and a one-page browser engine behind a disabled feature flag.
4. Run differential extraction/render tests against the Python implementation.
5. Ship local browser mode to internal users; preserve the current API fallback.
6. Move page retry and revision operations local.
7. Move rendering local only after golden parity; otherwise retain assisted final rendering temporarily.
8. Reduce Supabase schema to identity, entitlement, minimal metadata, and assisted jobs.
9. Split VPS API and isolated worker before external assisted traffic.
10. Remove cloud document persistence from the default path only after archive recovery and telemetry prove the local mode.

## Go/no-go decision

**Go** for an architecture spike and phased migration.

**No-go** for immediately replacing the current backend or promising zero downtime. Public default-local launch is blocked until storage durability, cross-browser behavior, engine parity, XSS/supply-chain controls, checkpoint recovery, archive portability, and assisted-mode isolation pass the gates above.

The safe production promise is not “it never fails.” It is: document content stays local by default; failures are bounded and visible; committed revisions are not corrupted; work resumes from verified checkpoints; users can export and restore their projects; and optional cloud processing is explicit, isolated, quota-bound, and deleted on schedule.
