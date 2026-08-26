#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${INK_COMPOSE_FILE:-${INFRA_DIR}/compose.yaml}"
DATA_VOLUME="${INK_DATA_VOLUME:-}"
DESTINATION="${1:-${INFRA_DIR}/backups}"
HELPER_IMAGE="${INK_BACKUP_HELPER_IMAGE:-alpine:3.23.3}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="ink-data-${STAMP}.tar.gz"

if [[ -z "${DATA_VOLUME}" && -f "${INFRA_DIR}/.env" ]]; then
  while IFS='=' read -r key value; do
    if [[ "${key}" == "INK_DATA_VOLUME" ]]; then
      DATA_VOLUME="${value%$'\r'}"
    fi
  done < "${INFRA_DIR}/.env"
fi
DATA_VOLUME="${DATA_VOLUME:-homeworker-data}"

if [[ ! "${DATA_VOLUME}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "INK_DATA_VOLUME must contain only letters, digits, dot, underscore, and hyphen." >&2
  exit 2
fi
if [[ "${DESTINATION}" == *','* || "${DESTINATION}" == *$'\n'* ]]; then
  echo "Backup destination cannot contain a comma or newline." >&2
  exit 2
fi

mkdir -p -- "${DESTINATION}"
DESTINATION="$(cd -- "${DESTINATION}" && pwd)"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

docker volume inspect "${DATA_VOLUME}" >/dev/null 2>&1 || {
  echo "Docker volume '${DATA_VOLUME}' does not exist; nothing to back up." >&2
  exit 1
}

api_was_running=false
if docker compose -f "${COMPOSE_FILE}" ps --status running --services | grep -qx api; then
  api_was_running=true
  echo "Stopping API briefly for an application-consistent snapshot..."
  docker compose -f "${COMPOSE_FILE}" stop -t 45 api
fi

restart_api() {
  if [[ "${api_was_running}" == true ]]; then
    docker compose -f "${COMPOSE_FILE}" start api >/dev/null
  fi
}
trap restart_api EXIT

echo "Writing ${DESTINATION}/${ARCHIVE}..."
docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=volume,src=${DATA_VOLUME},dst=/source,readonly" \
  --mount "type=bind,src=${DESTINATION},dst=/backup" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'cd /source && tar -czf "/backup/$1" .' sh "${ARCHIVE}"

docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${DESTINATION},dst=/backup" \
  "${HELPER_IMAGE}" \
  sh -eu -c 'cd /backup && sha256sum "$1" > "$1.sha256"' sh "${ARCHIVE}"

echo "Backup complete: ${DESTINATION}/${ARCHIVE}"
echo "Checksum: ${DESTINATION}/${ARCHIVE}.sha256"
