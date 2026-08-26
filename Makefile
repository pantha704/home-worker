.PHONY: context install dev api web test check build smoke clean

context:
	@bash scripts/context-check.sh

install: context
	pnpm install --frozen-lockfile
	cd services/api && uv sync --frozen --extra dev

api: context
	cd services/api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

web: context
	pnpm --filter @homeworker/web dev

dev: context
	@echo "Run 'make api' and 'make web' in separate terminals, or use Docker Compose."

test: context
	cd services/api && uv run pytest
	pnpm test

check: context
	cd services/api && uv run ruff check .
	cd services/api && uv run mypy app
	pnpm lint
	pnpm typecheck
	pnpm test

build: context
	pnpm build

smoke: context
	bash scripts/integration-smoke.sh

clean:
	@echo "Remove generated caches manually if needed; this target is intentionally non-destructive."
