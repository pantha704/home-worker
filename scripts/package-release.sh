#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="${1:-${repo_root}/../Homeworker-v0.2.0.zip}"
stage_root="$(mktemp -d -t homeworker-release.XXXXXX)"
stage_project="${stage_root}/Homeworker"

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

mkdir -p "$stage_project"
rsync -a \
  --include '.env.example' \
  --include '.env.*.example' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.next/' \
  --exclude '.git/' \
  --exclude '.venv/' \
  --exclude '.mypy_cache/' \
  --exclude '.pytest_cache/' \
  --exclude '.ruff_cache/' \
  --exclude '__pycache__/' \
  --exclude 'node_modules/' \
  --exclude 'coverage/' \
  --exclude 'build/' \
  --exclude 'dist/' \
  --exclude 'out/' \
  --exclude 'output/' \
  --exclude 'playwright-report/' \
  --exclude 'test-results/' \
  --exclude 'tmp/' \
  --exclude '*.egg-info/' \
  --exclude '*.tsbuildinfo' \
  --exclude '.coverage' \
  --exclude '.DS_Store' \
  --exclude '*.db' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite3' \
  --exclude '*.log' \
  "$repo_root/" "$stage_project/"

python3 "$stage_project/scripts/verify_release.py"
stage_archive="${stage_root}/Homeworker-v0.2.0.zip"
(
  cd "$stage_root"
  zip -q -r "$stage_archive" Homeworker
)
install -m 0644 "$stage_archive" "$output_path"
sha256sum "$output_path"
