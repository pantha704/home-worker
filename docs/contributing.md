# Contributing

Homeworker is a document-fidelity and safety product, not a handwriting-font demo. Every change must preserve source evidence, show uncertainty, keep rendering deterministic, and work without a paid provider.

## Before coding

1. Read `CONTEXT.md`, `PLAN.md`, and `AGENTS.md`.
2. State the user outcome and acceptance gate the change serves.
3. Identify contract, provenance, privacy, threat, accessibility, print, and migration impact.
4. Keep work inside the component boundary or coordinate ownership first.
5. Prefer the smallest deterministic, testable implementation.

## Local checks

Use the commands declared by the repository lockfiles/scripts. The standard CI sequence is:

```bash
# Backend (from services/api)
uv sync --frozen --extra dev
uv run ruff format --check .
uv run ruff check .
uv run pytest

# Frontend/workspace (from repository root)
corepack enable
pnpm install --frozen-lockfile
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web exec playwright install chromium
pnpm --dir apps/web test:e2e
pnpm --dir apps/web build

# Integrated stack (from infra)
docker compose config --quiet
docker compose build
docker compose up -d --wait
```

If a script is not implemented yet, add it in the owning component rather than weakening CI. CI is the final source of exact commands.

## Change requirements

- **Extraction/IR:** keep immutable source text/region/provenance; add gold fixture/evaluation and schema migration/versioning.
- **Review UI:** keyboard and screen-reader behavior, visible confidence/warnings, conflict-safe saves, and hostile-text XSS tests.
- **Renderer/persona:** prove license/redistribution, glyph coverage, checksum, deterministic gold output, exact A4/print-safe bounds, and typed companion parity.
- **Provider:** disabled by default, minimal data, explicit configuration/user notice, strict schema/timeouts, provenance, deterministic fallback, privacy documentation.
- **Persistence/job:** atomic commits, idempotency, interrupted-operation recovery, backup/migration/rollback test.
- **Security/limits:** fail safely with a structured code and no content leakage or partial state.

Never add signature cloning, named-person handwriting replication, identity-document generation, automatic assignment submission, implicit summarization, runtime CDN fonts/scripts, default telemetry, or mandatory cloud credentials.

## Pull requests

Keep commits focused and do not commit `.env`, keys, uploads, databases, exports, logs, caches, model weights without approved license, or real personal documents. A PR description should include:

- purpose and user-visible behavior;
- contracts/data migrations and compatibility;
- threat/privacy/license/accessibility impact;
- tests and corpus slices run with results;
- screenshots/render comparisons when UI/PDF changes;
- operational rollout and rollback.

Reviewers block silent content changes, missing uncertainty, unlicensed personas, unsafe input handling, remote-service requirements, or unmeasured rendering drift even if a demo looks better.

## Reporting security or privacy issues

Do not open a public issue containing a malicious/private document, exploit details against a live deployment, credentials, or user data. Contact the repository owner privately with version, metadata-only reproduction, impact, and a safe sample when possible. Preserve evidence and do not test against systems you do not own or have permission to assess.
