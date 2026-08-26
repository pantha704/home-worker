# Local-first services and upgrade path

Status: recommended defaults  
Last reviewed: 2026-07-15

“Free” means no mandatory software subscription or API fee. The operator still pays for their hardware, electricity, bandwidth, domain, and backups. Optional providers are never silently enabled.

## Default service matrix

| Capability | Free default | Why it is the default | Optional upgrade seam |
|---|---|---|---|
| Web/API hosting | Docker Compose on one machine | Reproducible and sufficient for the initial vertical slice | Any OCI host; split web/API only after measurement |
| Native PDF extraction | PyMuPDF | Fast local text, geometry, and raster access | Docling or managed document parser adapter |
| OCR | Tesseract with explicitly installed language packs | Offline, redistributable engine, predictable cost | PaddleOCR/Surya locally; managed OCR behind consented adapter |
| Semantic classification | Deterministic rules | No hallucination, no model/runtime requirement | Local Ollama adapter; external model only when enabled |
| Metadata | SQLite in WAL mode | Atomic, backupable, zero service dependency | PostgreSQL when write concurrency/HA requires it |
| Objects | Files below one data root | Easy inspection, quota, backup, and deletion | S3-compatible storage adapter |
| Jobs | Synchronous FastAPI thread-pool work inside a resource-capped API container | No broker or distributed state in the vertical slice | Bounded executor, then durable queue/workflow after restart/load evidence |
| PDF rendering | ReportLab/vector pipeline | Offline, deterministic A4 geometry | Specialized Rust renderer without changing IR |
| Cache | Process cache / disposable files | No operational dependency | Valkey only when horizontally scaling |
| Metrics/logs | Structured stdout + health endpoints | Works with Docker and local tools | OpenTelemetry/Prometheus/Grafana self-hosted |
| CI/security | GitHub Actions, Ruff, pytest, pnpm checks, Trivy | Free tooling and no runtime credentials | Hosted observability/security platform by choice |

## Provider policy

Every provider interface must expose capabilities, version, data destination, limits, timeout, and cost classification. Adapters receive only the minimum region/content required. The system records provider identity in provenance.

External adapters are compiled/installed optionally and remain disabled until all of the following are true:

1. An administrator selects the provider and configures credentials outside the repository.
2. Privacy/retention terms and data region are documented.
3. The UI tells the user that content will leave the machine and obtains an explicit action.
4. A corpus evaluation proves a material quality or latency improvement.
5. Failure falls back safely or produces a visible review requirement; it never guesses.

Uploaded text is untrusted provider input, not agent instruction. Provider output is schema-validated and cannot call tools, choose paths, change policy, or directly become a committed revision.

## OCR routing without paid services

1. Attempt native text extraction per page.
2. Score coverage, replacement-character rate, text/image ratio, ordering, and glyph sanity.
3. Raster only deficient pages/regions under pixel limits.
4. Run Tesseract with an allowed language pack and fixed parameters.
5. Merge evidence deterministically; conflicts or low scores become warnings for review.
6. Preserve tables, math, and figures as typed/structured blocks where confidence allows, otherwise preserve source regions with warnings rather than fabricate content.

Adding local PaddleOCR/Surya is an optimization profile, not a core dependency. Models are large, may have separate licenses, and must be pinned with checksums.

## Optional local Ollama adapter

Ollama may classify blocks or flag anomalies, but it is not authoritative OCR, revision storage, or workflow state. It is off by default and must satisfy:

- loopback-only endpoint allowlist;
- fixed model name and recorded model digest;
- strict structured output validation;
- bounded input/output and timeout;
- no tools, network retrieval, or instructions from document content;
- a deterministic fallback when unavailable.

The faithful transcription flow works identically without it.

The optional Compose profile pins `ollama/ollama:0.32.0` and defaults to `qwen3:4b` (approximately a 2.5 GB download). Both are overridable. The model is not pulled automatically: the operator starts the profile and downloads it explicitly. Budget at least 6 GB container RAM plus model disk. The implemented adapter may refine block kinds only; it bounds input/response, requests schema-constrained JSON, preserves text, and adds `LOCAL_ANALYZER_FALLBACK` while retaining rules output on any failure. Keep `ANALYZER_PROVIDER=rules` unless the local model is explicitly wanted and corpus-tested; merely starting Ollama does not change the result.

## When to upgrade

| Signal sustained in production | Consider | Do not do first |
|---|---|---|
| SQLite write contention or multiple API replicas required | PostgreSQL | Dual-write migration |
| Local objects exceed one host or HA/RPO requires replication | S3-compatible object store | Public buckets |
| Jobs routinely exceed request lifecycle or survive restarts poorly | Durable queue/workflow | LLM-controlled workflow state |
| OCR CPU queue violates latency SLO | Dedicated CPU workers and backpressure | Unbounded autoscaling |
| Renderer CPU dominates and corpus shows quality benefit | Rust rendering service/library | Diffusion-generated full pages |
| Regional/privacy contracts require isolation | Per-region deployments | Sending data across regions by default |

Migration order is repository interface, shadow-read verification, explicit cutover, then rollback window. Never change storage and IR semantics in one release.

## Version and supply-chain policy

- Application and container dependencies are locked; CI uses frozen installs.
- Container bases and GitHub Actions use reviewed immutable digests for release tags when the lock is finalized.
- Automated update PRs are allowed, but extraction/rendering upgrades require corpus and golden-output evaluation.
- Persona/font packages include license text, source, version, glyph coverage, and SHA-256. Unknown or non-redistributable packages are rejected.
- No telemetry, remote font, CDN script, or model download is required at runtime.

The checked-in CI/security workflows use only free/open tooling and require no scanner token. GitHub-hosted runners for a private repository still consume the account's included Actions minutes and may incur charges if the operator enables billing and exceeds that quota. To guarantee zero runner cost, execute the same commands locally or on a self-hosted runner; the application runtime does not depend on CI.
