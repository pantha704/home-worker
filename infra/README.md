# Local infrastructure

The default stack is two containers and one persistent volume:

- `web` on `http://localhost:3000`;
- `api` on `http://localhost:8000`;
- `homeworker-data` for SQLite, source objects, revisions, and exports.

Both ports bind to loopback. Core startup requires no API key, model, database service, or paid account.

## Start the core

```bash
cp .env.example .env
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
```

Do not expose this no-auth local profile remotely. See [the deployment guide](../docs/deployment.md) before changing bind addresses.

For the separate all-free public-beta profile, use [the zero-cost deployment guide](../docs/free-public-deployment.md). It uses Cloudflare Pages Free, Render Free, and Supabase Free with explicit hard quotas and no paid persistent disk.

## Optional local Ollama

Ollama is a disabled Compose profile. It is free/local, but its model consumes bandwidth, disk, CPU, and RAM. The default `qwen3:4b` download is approximately 2.5 GB; allow at least 6 GB container memory. The core rules analyzer does not contact or depend on Ollama.

Start the service and explicitly download the model:

```bash
docker compose --profile ollama up -d ollama
docker compose --profile ollama exec ollama ollama pull qwen3:4b
```

To enable the implemented constrained block-kind analyzer, set these values in `.env` and recreate the API:

```dotenv
ANALYZER_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_TIMEOUT_SECONDS=20
```

The adapter sends bounded block text, requests schema-constrained JSON, may refine block kinds only, and cannot change text/workflow/storage. Any timeout, missing model, invalid response, or service error visibly adds `LOCAL_ANALYZER_FALLBACK` and retains deterministic rule output. The profile never publishes Ollama's port to the host and never pulls a model during normal core startup. `ANALYZER_PROVIDER=rules` is the supported zero-model default.

## Data and backups

`docker compose down` preserves the named volume. `docker compose down --volumes` deletes it and should not be used for routine operation.

The backup script reads an unquoted `INK_DATA_VOLUME` from `infra/.env` when the variable is not exported, so custom volume names stay aligned with Compose.

```bash
./scripts/backup.sh ./backups
INK_RESTORE_VOLUME=homeworker-restore-1 ./scripts/restore.sh ./backups/ink-data-<timestamp>.tar.gz
```

Restore always targets a new volume. Follow the validation/cutover steps in [the operations runbook](../docs/operations-runbook.md).
