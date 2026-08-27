#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="${1:-${repo_root}/../Homeworker-v0.2.0.zip}"
treeish="${HOMEWORKER_RELEASE_TREEISH:-HEAD}"
stage_root="$(mktemp -d -t homeworker-release.XXXXXX)"
stage_archive="${stage_root}/Homeworker-v0.2.0.zip"
stage_tar="${stage_root}/Homeworker-v0.2.0.tar"
stage_project="${stage_root}/Homeworker"

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

# A release is a reproducible snapshot of committed source. Git-ignored runtime
# data, dependencies, caches, and private planning notes can never enter it.
git -C "$repo_root" archive --format=zip --prefix=Homeworker/ --output="$stage_archive" "$treeish"
git -C "$repo_root" archive --format=tar --prefix=Homeworker/ --output="$stage_tar" "$treeish"

python3 - "$stage_tar" "$stage_root" <<'PY'
from pathlib import Path
import sys
import tarfile

archive = Path(sys.argv[1])
destination = Path(sys.argv[2])
with tarfile.open(archive) as release:
    release.extractall(destination)
PY

python3 "$stage_project/scripts/verify_release.py"
install -m 0644 "$stage_archive" "$output_path"
sha256sum "$output_path"
