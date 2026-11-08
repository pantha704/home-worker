# Version baseline

Reviewed: 2026-11-08

Homeworker pins executable dependencies so a local checkout and CI resolve the same tested graph. The lockfiles are authoritative; this file explains the deliberate top-level baseline.

## Toolchain and local services

| Component | Version / range | Purpose |
|---|---:|---|
| Node.js | 24.18.0 in containers and CI | Next.js build/runtime |
| pnpm | 11.18.0 | JavaScript workspace and lockfile |
| Python | `>=3.12,<3.15`; 3.14.6 in containers and CI | API and document pipeline |
| uv | 0.11.28 in containers and CI | Python resolution and execution |
| Tesseract | distribution-provided 5.x | Free local OCR |
| Ollama | 0.32.0, optional profile | Free local structural analyzer |
| Ollama model | `qwen3:4b`, optional | Kind classification only; never rewriting |

## Web application

| Package | Pin |
|---|---:|
| Next.js | 16.4.1 |
| React / React DOM | 19.2.7 |
| TypeScript | 5.9.3 |
| ESLint / eslint-config-next | 9.39.1 / 16.4.1 |
| Vite / Vitest | 8.1.6 / 4.1.12 |
| Playwright | 1.61.1 |
| Testing Library React | 16.3.2 |
| PostCSS override | 8.5.23 |
| Supabase JS | 2.111.0 |

The PostCSS workspace override keeps Next.js on the patched 8.5 line. TypeScript and ESLint intentionally remain on tested compatibility lines instead of moving to incompatible next-major parser/rule APIs.

## API application

| Package | Pin |
|---|---:|
| FastAPI | 0.139.2 |
| Uvicorn | 0.51.0 |
| Pydantic | 2.13.4 |
| SQLAlchemy | 2.0.51 |
| PyMuPDF | 1.28.0 |
| Pillow | 13.0.0 |
| PyJWT | 2.15.0 |
| pytesseract | 0.3.13 |
| ReportLab | 5.0.0 |
| Ruff | 0.15.21 |
| mypy | 2.3.0 |
| pytest / pytest-cov | 9.1.1 / 7.1.0 |

## Free hosted services

| Component | Tested profile | Purpose |
|---|---|---|
| Cloudflare Pages | Free | Static web application |
| Render | Free web service | FastAPI, Tesseract, and one leased worker |
| Supabase | Free | Magic-link Auth, PostgreSQL, private Storage |
| Supabase CLI | 2.111.0 | Hosted schema migration |

## Update policy

Update pins and lockfiles together, run the unit and integration suites, visually inspect every PDF persona, and require clean production dependency audits:

```bash
pnpm audit --prod
cd services/api
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file /tmp/homeworker-requirements.txt
uvx pip-audit --requirement /tmp/homeworker-requirements.txt
```

Do not replace a tested compatibility pin merely to match a higher major version number. Record the reason and upgrade when the full toolchain supports it.

Security exceptions override the compatibility rule: a HIGH or CRITICAL advisory is fixed immediately, even across a major version, provided the full suite and the browser e2e run stay green. `--no-hashes` is required when exporting the lockfile for `pip-audit`, because hash checking aborts the dry-run install.
