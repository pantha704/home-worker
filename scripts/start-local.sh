#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

bash scripts/context-check.sh

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker with Compose v2 is required. See docs/deployment.md for native setup."
  exit 1
fi

docker compose --env-file infra/.env.example -f infra/compose.yaml up --build

