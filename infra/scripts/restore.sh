#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${INK_COMPOSE_FILE:-${INFRA_DIR}/compose.yaml}"
TARGET_VOLUME="${INK_RESTORE_VOLUME:-}"
ARCHIVE_INPUT="${1:-}"
HELPER_IMAGE="${INK_BACKUP_HELPER_IMAGE:-alpine:3.23.3}"

if [[ -z "${ARCHIVE_INPUT}" || -z "${TARGET_VOLUME}" ]]; then
  echo "Usage: INK_RESTORE_VOLUME=<new-volume-name> $0 <backup.tar.gz>" >&2
  exit 2
fi

if [[ ! "${TARGET_VOLUME}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "INK_RESTORE_VOLUME must contain only letters, digits, dot, underscore, and hyphen." >&2
  exit 2
fi
if [[ "${ARCHIVE_INPUT}" == *','* || "${ARCHIVE_INPUT}" == *$'\n'* ]]; then
  echo "Archive path cannot contain a comma or newline." >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

if docker compose -f "${COMPOSE_FILE}" ps --status running --services | grep -qx api; then
  echo "Refusing restore while the API is running. Stop it first." >&2
  exit 1
fi

ARCHIVE_DIR="$(cd -- "$(dirname -- "${ARCHIVE_INPUT}")" && pwd)"
ARCHIVE_NAME="$(basename -- "${ARCHIVE_INPUT}")"
ARCHIVE="${ARCHIVE_DIR}/${ARCHIVE_NAME}"
CHECKSUM="${ARCHIVE}.sha256"

[[ -f "${ARCHIVE}" ]] || {
  echo "Archive not found: ${ARCHIVE}" >&2
  exit 1
}
[[ -f "${CHECKSUM}" ]] || {
  echo "Checksum file not found: ${CHECKSUM}" >&2
  exit 1
}

docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${ARCHIVE_DIR},dst=/backup,readonly" \
  "${HELPER_IMAGE}" \
  sh -eu -c '
    cd /backup
    expected="$(sed -n "1s/[[:space:]].*//p" "$1.sha256")"
    case "${expected}" in
      *[!0-9a-f]*|"") exit 1 ;;
    esac
    test "${#expected}" -eq 64
    actual="$(sha256sum "$1" | awk "{print \\$1}")"
    test "${actual}" = "${expected}"
  ' sh "${ARCHIVE_NAME}" || {
  echo "Checksum verification failed." >&2
  exit 1
}

docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${ARCHIVE},dst=/backup/archive.tar.gz,readonly" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'tar -tzf /backup/archive.tar.gz >/dev/null'

if docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${ARCHIVE},dst=/backup/archive.tar.gz,readonly" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'tar -tzf /backup/archive.tar.gz | grep -Eq "(^/|(^|/)\.\.(/|$))"'; then
  echo "Archive contains an unsafe path; refusing restore." >&2
  exit 1
fi

if docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${ARCHIVE},dst=/backup/archive.tar.gz,readonly" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'tar -tvzf /backup/archive.tar.gz | grep -Eq "^[^-d]"'; then
  echo "Archive contains a link or special file; refusing restore." >&2
  exit 1
fi

if docker volume inspect "${TARGET_VOLUME}" >/dev/null 2>&1; then
  echo "Target volume '${TARGET_VOLUME}' already exists. Restore requires a new volume." >&2
  exit 1
fi

read -r -p "Type the new volume name '${TARGET_VOLUME}' to create and restore it: " confirmation
[[ "${confirmation}" == "${TARGET_VOLUME}" ]] || {
  echo "Confirmation did not match; restore cancelled." >&2
  exit 1
}

docker volume create "${TARGET_VOLUME}" >/dev/null
created=true
cleanup_failed_restore() {
  if [[ "${created:-false}" == true ]]; then
    docker volume rm "${TARGET_VOLUME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_restore ERR

docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${ARCHIVE},dst=/backup/archive.tar.gz,readonly" \
  --mount "type=volume,src=${TARGET_VOLUME},dst=/target" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'cd /target && tar -xzf /backup/archive.tar.gz'

created=false
trap - ERR
echo "Restore complete in new volume: ${TARGET_VOLUME}"
echo "Set INK_DATA_VOLUME=${TARGET_VOLUME}, start the stack, then follow the validation checklist in docs/operations-runbook.md."
