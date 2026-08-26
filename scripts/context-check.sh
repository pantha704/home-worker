#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '%s\n' "Homeworker execution context"
printf '%s\n' "Purpose: faithful, reviewable document-to-different-handwriting A4 conversion."
printf '%s\n' "Gate: no silent mutations; provenance and uncertainty must remain visible."
printf '%s\n' "Plan: local-first core, optional providers, deterministic export, verified before delivery."
printf '%s\n' "Context: ${repo_root}/CONTEXT.md"
printf '%s\n' "Plan: ${repo_root}/PLAN.md"

