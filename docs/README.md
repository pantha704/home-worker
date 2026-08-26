# Homeworker documentation

These documents describe the production intent of the local-first vertical slice. They are part of the product contract: a change that weakens provenance, reviewability, safety, or deterministic printing requires an explicit architecture decision.

## Start here

- [Architecture](architecture.md): components, trust boundaries, state, and data flow.
- [Canonical IR and API contract](contracts.md): invariants and versioned HTTP assumptions.
- [Local-first services](local-first-services.md): free defaults and optional upgrade seams.
- [Threat model](threat-model.md): abuse cases and required controls.
- [Privacy and retention](privacy-retention.md): data lifecycle and user controls.
- [Operations runbook](operations-runbook.md): health, incidents, backups, and recovery.
- [Troubleshooting](troubleshooting.md): common local setup, OCR, browser, and rendering failures.
- [Deployment guide](deployment.md): local Docker and hardened single-host deployment.
- [Test strategy and SLOs](test-strategy-and-slos.md): release gates and reliability targets.
- [Contributing](contributing.md): safe change workflow.
- [Architecture decisions](adrs/README.md): durable decisions and their consequences.

`CONTEXT.md`, `PLAN.md`, and `AGENTS.md` at the repository root take precedence if a document becomes stale.
