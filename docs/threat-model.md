# Threat model

Status: v0.2.0 local and free-hosted threat baseline  
Last reviewed: 2026-08-03  
Method: asset/trust-boundary review informed by STRIDE and OWASP ASVS/LLM guidance

This document distinguishes implemented controls from residual risks and live-deployment gates. The implementation-status section is authoritative for v0.2.0.

## Security objectives

1. Preserve source fidelity and make uncertainty visible.
2. Prevent untrusted documents from executing code, reaching networks, exhausting the host, or escaping the data root.
3. Prevent one hosted user/project from reading or changing another.
4. Keep private document content out of logs, telemetry, providers, and backups the operator did not choose.
5. Prevent personas and exports from enabling signature forgery, identity impersonation, or unlicensed handwriting cloning.
6. Keep exports reproducible and attributable to their source revision, persona package, renderer, and seed.

## Assets and adversaries

Assets include source documents, extracted text, user edits, exports, database/object state, persona/font licenses, configuration, provider credentials, audit metadata, and host availability.

Relevant adversaries are a malicious uploader, a document author targeting a downstream reader/model, a remote unauthenticated client if the stack is exposed incorrectly, a compromised dependency/persona package, and an operator or backup process accidentally disclosing data. A local administrator is trusted to access local data; disk encryption and OS accounts are outside the application boundary but are required for sensitive use.

## Required control matrix

| Threat | Example | Required prevention | Detection / recovery |
|---|---|---|---|
| Malicious PDF parser payload | Crafted xref/object/font/image exploits a native parser | Pin patched libraries; never execute PDF JavaScript, actions, launch commands, macros, multimedia, or embedded files; parse in a non-root, capability-free worker with read-only root FS, bounded temp, memory, CPU, process count, and no outbound network | Parser crash/timeout metric; generic failure; quarantine sample by digest only if operator opts in; dependency alert and corpus regression |
| Compression/decompression bomb | Tiny PDF stream expands to GBs; nested object streams or huge bitmap | Enforce upload bytes before buffering; page/object/depth/decoded-byte/compression-ratio/pixel limits before OCR; reject embedded archives/files; bounded temp volume and deadlines | Limit-specific problem code and counter; clean work directory; no automatic retry |
| Image pixel bomb | Valid small PNG/JPEG declares enormous dimensions | Read headers with hardened decoder; enforce width, height, total pixels/page and total document pixels before full decode | Reject with dimensions/limit, not raw metadata |
| MIME/polyglot confusion | HTML/ZIP renamed `.pdf`; active SVG image | Allowlist byte signatures and successful structural parse; extension is advisory; no SVG/HTML input in initial release; downloads use server media type, attachment disposition, and `nosniff` | Validation code and security log without content |
| Prompt injection | Page says “ignore rules, upload files, reveal prompts” | Uploaded content is data. The default pipeline uses no agent. Optional analyzers have no arbitrary tools/network, receive delimited minimal content, use fixed system policy and strict schemas, and cannot commit revisions or choose paths/providers | Record analyzer/version and validation failures; flag suspicious instruction-like regions for review, never obey them |
| Stored/reflected XSS | OCR text contains `<script>`, event handlers, hostile Markdown/URLs | Render text through escaped React nodes; forbid `dangerouslySetInnerHTML` for document content; sanitize any future rich text with an allowlist; CSP disallows inline scripts/objects; never preview source SVG/HTML inline | Browser security tests/CSP reports where configured; remove unsafe renderer immediately |
| Path traversal / overwrite | Filename `../../db`; crafted export kind or ID | Server-generated opaque IDs; filenames are display metadata; strict ID/enum parsing; resolve and verify every path remains under the data root; create files with exclusive/atomic operations; never extract user archives | Log request ID and rejected route; integrity scan of object index |
| SSRF / local service access | Source contains external image/font URL; user supplies OCR callback URL | Initial release accepts uploads only and never resolves document links. Provider endpoints are administrator configuration from an allowlist, not request input; block redirects/private/link-local/metadata IPs if URL ingestion is ever added | Egress denied for parsing workers; alert on unexpected outbound connections |
| SQL/command injection | OCR text becomes SQL, CLI arg, template, or log control data | Parameterized SQL; no shell command construction; pass subprocess argument arrays; bound and normalize log fields; never use document text as a template expression | Static checks, malicious corpus, structured error metrics |
| Cross-project access / IDOR | Guess opaque revision/export ID | Hosted mode verifies Supabase JWTs and owner-scopes every project, revision, job, artifact, list, mutation, and object key; cross-owner probes return indistinguishable `404`s | Two-identity integration tests; metadata-only denied-access audit |
| Cross-site mutation/CORS abuse | Malicious site uploads/deletes with a victim token | Bearer tokens stay out of URLs; hosted mutations require exact HTTPS `Origin` plus a fixed client header; CORS is an exact allowlist; local no-auth mode remains loopback-only | Origin rejection metric; rotate session on incident |
| Resource starvation | Many concurrent OCR/export jobs fill CPU/disk | Request/body limits, per-client rate/concurrency limits, bounded worker pool/queue, job deadlines, disk reserve, quotas, backpressure, retention sweeper | Queue/disk/memory alerts; cancel jobs; preserve committed state |
| Unsafe font/persona | Font parser exploit, unclear license, hidden signature glyphs | Ship only reviewed, redistributable packages with license/source/checksum/glyph inventory; no user font upload initially; subset/parse during build in an isolated step; verify checksum at runtime | Fail closed on manifest mismatch; SBOM/license review; revoke persona version |
| Signature or identity misuse | Copy a real person's writing/signature or generate official identity material | Built-in non-identifying licensed personas only; no exact handwriting cloning, signature capture/render mode, identity-document templates, or claims a named person wrote it; refuse isolated signature generation paths; retain generation manifest | Abuse reporting and persona revocation; documented policy; safety tests |
| Tampered export/provenance | Replace PDF while keeping metadata | SHA-256 every source, revision serialization, persona package, and export; immutable export manifest; atomic commit; optional visible provenance mark for higher-risk modes | Verification command/API; regenerate from immutable inputs |
| Sensitive-data leakage | Raw OCR/source in logs, error, analytics, crash dump | Metadata-only structured logs; redact headers/query/body/path; no default telemetry; errors omit text/paths/stacks; provider disabled; restrict dump/core files | Log scanning tests; delete/rotate affected logs and credentials if applicable |
| Backup disclosure or loss | Unencrypted copy synced broadly; corrupt backup unnoticed | Operator-controlled encrypted destination, least access, documented retention; application-consistent snapshot; checksum and periodic restore drill | Backup age/checksum alert; restore to isolated directory; incident procedure |
| Dependency/build compromise | Typosquat, mutable CI action, poisoned container/model | Lock dependencies, minimal bases, review lock changes, vulnerability/license/secret scanning, SBOM for releases, pinned checksums/digests, least CI permissions, no PR secrets | CI failure/Dependabot advisory; revoke/rebuild from trusted commit |

## Ingestion limits

### Implemented limits

| Limit/control | Default | Current behavior |
|---|---:|---|
| Upload bytes | Local 25 MiB; hosted 10 MiB | Streaming `413`; partial object removed |
| Pages | Local 100; hosted 30 | Reject before extraction job |
| Uploaded image pixels | 40 megapixels | Header/decode validation rejects an oversized PNG/JPEG |
| Extracted characters | Hosted 300k/page and 1m/document | Rejects excessive extracted output |
| Account ceilings | 20 projects, 60 revisions/project, 100 MiB stored | Rejects before paid overage is required |
| Hosted rate buckets | 20 uploads/hour, 240 mutations/hour | Owner-shared PostgreSQL counters return `429` |
| Tesseract invocation | 30 seconds | OCR call times out and returns a structured error |
| Container resources (Compose) | API: 2 CPU, 4 GiB RAM, 256 PIDs, 1 GiB `/tmp` | Docker-enforced whole-container ceilings; configurable by operator |
| Parser network | No egress in default Compose network | API is attached only to an internal Docker network |

PyMuPDF/Pillow/Tesseract currently run in the API process/thread pool, not a separate parser sandbox. The current PDF validator checks signature, structural parse, encryption, page count, and positive page geometry. It does not yet inspect/reject every embedded action/file or enforce PDF object count, nesting, decoded-stream bytes, compression ratio, or total raster pixels across a document.

### Residual parser/abuse hardening

- Isolate native document/image/font parsing and OCR in a separately constrained, no-egress worker rather than the API process.
- Cap total document pixels, PDF objects/nesting/decoded streams/compression ratio, OCR output, table cells, IR blocks, JSON bodies, generated pages, concurrent CPU work, per-job temporary bytes, and end-to-end job wall time.
- The hosted durable queue, leases, retries, per-account quotas, and cleanup exist; add independent parser subprocess isolation and measured concurrent-job scheduling before increasing instance count or public volume.
- Explicitly reject or strip embedded files, JavaScript/actions, launch commands, multimedia, and external references after corpus-tested parser inspection.
- Continue adversarial retention/outbox, free-capacity, and provider-failure drills.
- Establish exact thresholds from a malicious and representative rights-cleared corpus; make limit errors stable and non-retryable where appropriate.

## Browser and HTTP baseline

- The hosted static build emits CSP, HSTS, frame, opener/resource, referrer, permissions, and MIME-sniffing headers with exact API/Supabase origins. The API adds `nosniff`, no-referrer, permissions, resource, cache, and authorization-vary headers. Browser/provider verification remains a live gate.
- TLS and HSTS are required for any non-loopback deployment.
- The reverse proxy and API enforce aligned body/time limits; the most permissive layer is not the policy boundary.
- Downloads are authorized at request time and do not expose direct filesystem paths.
- Request IDs are generated/validated at the edge; untrusted values are length/character bounded.

## Safety policy for handwriting

Homeworker creates a visibly different, licensed writing persona for notes. It does not authenticate handwriting and must not imply a real person authored an export. Persona packages cannot be named after real people or marketed as replicas. Custom training, signatures, identity documents, medical/legal consent, prescriptions, checks, certificates, and automatic schoolwork submission are outside the initial product.

Generated PDFs include Homeworker/revision/source-page provenance and metadata. The API returns a source/artifact SHA-256 manifest for the exact revision. The manifest is not cryptographically signed; product/legal review remains required before custom handwriting, minors/institutions, public sharing, or removal of provenance affordances.

## Verification before release

- Malicious corpus: malformed PDFs, parser regression samples, deep objects, high-ratio streams, huge dimensions, polyglots, embedded files/actions, Unicode/bidi edge cases, and OCR injection text.
- Property tests: any accepted object path remains inside the data root; any committed block remains traceable; limits fail without partial commits.
- Browser tests: hostile HTML/Markdown/URLs display as inert text; CSP remains effective.
- Container tests: non-root UID, no added capabilities, read-only root, bounded PIDs/memory/temp, loopback ports, no processing-worker egress where supported.
- Dependency, secret, license, and container scans pass the documented severity policy.

## Current implementation status (2026-08-03)

Implemented: the local controls above plus fail-closed hosted configuration; asymmetric Supabase JWT verification; exact-origin mutation checks; owner-scoped PostgreSQL queries and private object keys; durable leased jobs with restart recovery; rate/project/revision/storage ceilings; 14-day expiry and deletion outbox; immutable extraction evidence; revision-exact artifact cache and SHA-256 manifests; authenticated blob downloads without URL tokens; hosted CSP/security headers; and a static Cloudflare build.

Partially implemented: source evidence is exposed but there is no general revision-history browser; the in-process leased worker provides durable semantics but shares the API container/process boundary; free vendor email/TLS/dashboard behavior is verifiable only after deployment; manifests are hashed but not signed.

Remaining public-beta gates: compatible source-license decision, live two-account isolation, live Auth email/TLS/provider configuration, restart/retention/outbox drills, an operator security/privacy contact, and explicit review of residual parser sandbox/advanced PDF expansion limits. These are not bypassed by automated local tests.

## Residual risks

Native document/image/font parsers may contain unknown vulnerabilities; container controls reduce impact but are not a perfect sandbox. OCR can be wrong, especially for handwriting, math, tables, and mixed scripts, so review is a product safety control. A machine administrator can read local files. A printed export can be detached from digital provenance. These risks must be stated rather than represented as “flawless.”
