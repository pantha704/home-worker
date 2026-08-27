#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_port="${INK_SMOKE_API_PORT:-18080}"
web_port="${INK_SMOKE_WEB_PORT:-13080}"
api_url="http://127.0.0.1:${api_port}"
web_url="http://127.0.0.1:${web_port}"
keep_workdir="${INK_SMOKE_KEEP:-0}"

for command in curl jq pdfinfo pgrep uv; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

if [[ -n "${INK_SMOKE_WORKDIR:-}" ]]; then
  workdir="$INK_SMOKE_WORKDIR"
  mkdir -p "$workdir"
  keep_workdir=1
else
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/homeworker-smoke.XXXXXX")"
fi

api_pid=""
web_pid=""
web_dist_dir="tmp/smoke-next-$$"

terminate_tree() {
  local pid="$1"
  local child
  while read -r child; do
    [[ -n "$child" ]] && terminate_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  if [[ -n "$web_pid" ]]; then
    terminate_tree "$web_pid"
  fi
  if [[ -n "$api_pid" ]]; then
    terminate_tree "$api_pid"
  fi
  if [[ "$keep_workdir" != "1" ]]; then
    rm -rf "$workdir"
  else
    printf 'Smoke artifacts: %s\n' "$workdir"
  fi
  rm -rf "$repo_root/apps/web/$web_dist_dir"
}
trap cleanup EXIT INT TERM

on_error() {
  local status="$?"
  printf 'Integration smoke failed at line %s (status %s).\n' "${BASH_LINENO[0]}" "$status" >&2
  exit "$status"
}
trap on_error ERR

wait_for_url() {
  local url="$1"
  local log_file="$2"
  local attempt
  for attempt in $(seq 1 120); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  printf 'Timed out waiting for %s\n' "$url" >&2
  sed -n '1,160p' "$log_file" >&2 || true
  return 1
}

assert_json() {
  local expression="$1"
  local file="$2"
  if ! jq --exit-status "$expression" "$file" >/dev/null; then
    printf 'JSON assertion failed: %s (%s)\n' "$expression" "$file" >&2
    jq . "$file" >&2 || true
    return 1
  fi
}

pdf_contains_text() {
  local file="$1"
  local expected="$2"
  (
    cd "$repo_root/services/api"
    uv run --frozen python -c \
      'import fitz, sys; document = fitz.open(sys.argv[1]); text = "\n".join(page.get_text() for page in document); raise SystemExit(0 if sys.argv[2] in text else 1)' \
      "$file" "$expected"
  )
}

cd "$repo_root"
bash scripts/context-check.sh >/dev/null
mkdir -p "$workdir/storage"

(
  cd services/api
  INK_STORAGE_ROOT="$workdir/storage" \
  INK_DATABASE_URL="sqlite:///$workdir/homeworker.db" \
  INK_CORS_ORIGINS="$web_url" \
    "$repo_root/services/api/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$api_port"
) >"$workdir/api.log" 2>&1 &
api_pid="$!"

(
  cd "$repo_root/apps/web"
  HOMEWORKER_NEXT_DIST_DIR="$web_dist_dir" \
  NEXT_PUBLIC_API_BASE_URL="$api_url" NEXT_TELEMETRY_DISABLED=1 \
    "$repo_root/apps/web/node_modules/.bin/next" dev --hostname 127.0.0.1 --port "$web_port"
) >"$workdir/web.log" 2>&1 &
web_pid="$!"

wait_for_url "$api_url/ready" "$workdir/api.log"
wait_for_url "$web_url/" "$workdir/web.log"
curl --fail --silent --show-error "$web_url/" >"$workdir/home.html"
grep -F "Notes that feel written" "$workdir/home.html" >/dev/null
curl --fail --silent --show-error "$api_url/v1/personas" >"$workdir/personas.json"
assert_json 'map(.id) | sort == ["casual", "compact", "scholar"]' "$workdir/personas.json"

curl --fail --silent --show-error \
  -F "file=@$repo_root/fixtures/sample-typed.pdf;type=application/pdf" \
  "$api_url/v1/projects" >"$workdir/typed-created.json"
assert_json '.status == "needs_review" and .revision == 1 and .mimeType == "application/pdf"' "$workdir/typed-created.json"
assert_json '[.pages[].blocks[].source.extractor] | all(. == "native_pdf")' "$workdir/typed-created.json"

typed_id="$(jq -r '.id' "$workdir/typed-created.json")"
typed_block="$(jq -r '.pages[0].blocks[0].id' "$workdir/typed-created.json")"

curl --fail --silent --show-error \
  --dump-header "$workdir/draft.headers" \
  "$api_url/v1/projects/$typed_id/export.pdf" >"$workdir/draft-a.pdf"
curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/export.pdf" >"$workdir/draft-b.pdf"
cmp "$workdir/draft-a.pdf" "$workdir/draft-b.pdf"
pdfinfo "$workdir/draft-a.pdf" | grep -F '(A4)' >/dev/null
pdf_contains_text "$workdir/draft-a.pdf" 'DRAFT - REVIEW REQUIRED'
grep -i '^content-disposition: inline;' "$workdir/draft.headers" >/dev/null

jq -n \
  --arg text "Physics Notes — reviewed in the integration flow" \
  '{text: $text, expectedRevision: 1}' >"$workdir/block-patch.json"
curl --fail --silent --show-error -X PATCH \
  -H 'Content-Type: application/json' \
  --data-binary "@$workdir/block-patch.json" \
  "$api_url/v1/projects/$typed_id/blocks/$typed_block" >"$workdir/typed-edited.json"
assert_json '.revision == 2 and .pages[0].blocks[0].reviewed == true and .pages[0].blocks[0].source.extractor == "manual"' "$workdir/typed-edited.json"

stale_status="$(curl --silent --show-error --output "$workdir/stale.json" --write-out '%{http_code}' \
  -X PATCH -H 'Content-Type: application/json' \
  --data-binary "@$workdir/block-patch.json" \
  "$api_url/v1/projects/$typed_id/blocks/$typed_block")"
[[ "$stale_status" == "409" ]]
assert_json '.error.code == "REVISION_CONFLICT" and .error.details.currentRevision == 2' "$workdir/stale.json"

jq -n '{expectedRevision: 2, personaId: "casual", paperStyle: "grid", seed: 9001}' \
  >"$workdir/settings-patch.json"
curl --fail --silent --show-error -X PATCH \
  -H 'Content-Type: application/json' \
  --data-binary "@$workdir/settings-patch.json" \
  "$api_url/v1/projects/$typed_id/settings" >"$workdir/typed-settings.json"
assert_json '.revision == 3 and .settings.personaId == "casual" and .settings.paperStyle == "grid"' "$workdir/typed-settings.json"

curl --fail --silent --show-error -X POST \
  -H 'Content-Type: application/json' \
  --data-binary '{"expectedRevision":3}' \
  "$api_url/v1/projects/$typed_id/confirm" >"$workdir/typed-confirmed.json"
assert_json '.status == "ready" and .revision == 4' "$workdir/typed-confirmed.json"

curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/export.pdf" >"$workdir/persona-casual.pdf"

jq -n '{expectedRevision: 4, personaId: "compact"}' >"$workdir/compact-settings.json"
curl --fail --silent --show-error -X PATCH \
  -H 'Content-Type: application/json' \
  --data-binary "@$workdir/compact-settings.json" \
  "$api_url/v1/projects/$typed_id/settings" >"$workdir/typed-compact.json"
assert_json '.status == "ready" and .revision == 5 and .settings.personaId == "compact"' "$workdir/typed-compact.json"
curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/export.pdf" >"$workdir/persona-compact.pdf"

jq -n '{expectedRevision: 5, personaId: "scholar"}' >"$workdir/scholar-settings.json"
curl --fail --silent --show-error -X PATCH \
  -H 'Content-Type: application/json' \
  --data-binary "@$workdir/scholar-settings.json" \
  "$api_url/v1/projects/$typed_id/settings" >"$workdir/typed-scholar.json"
assert_json '.status == "ready" and .revision == 6 and .settings.personaId == "scholar"' "$workdir/typed-scholar.json"
curl --fail --silent --show-error \
  --dump-header "$workdir/final.headers" \
  "$api_url/v1/projects/$typed_id/export.pdf?revision=6" >"$workdir/persona-scholar.pdf"
grep -i '^content-disposition: attachment;' "$workdir/final.headers" >/dev/null

curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/export.pdf?revision=4" >"$workdir/persona-casual-historical.pdf"
cmp "$workdir/persona-casual.pdf" "$workdir/persona-casual-historical.pdf"

curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/source.json" >"$workdir/extraction-evidence.json"
assert_json '.revision == 1 and ([.pages[].blocks[].source.extractor] | all(. == "native_pdf"))' \
  "$workdir/extraction-evidence.json"

curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/manifest.json?revision=6&kind=handwritten_pdf" \
  >"$workdir/manifest.json"
artifact_sha="$(sha256sum "$workdir/persona-scholar.pdf" | cut -d ' ' -f 1)"
artifact_bytes="$(wc -c < "$workdir/persona-scholar.pdf" | tr -d ' ')"
jq --exit-status --arg sha "$artifact_sha" --argjson bytes "$artifact_bytes" \
  '.projectRevision == 6 and .artifactKind == "handwritten_pdf" and .artifactSha256 == $sha and .artifactBytes == $bytes' \
  "$workdir/manifest.json" >/dev/null

curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/companion.pdf" >"$workdir/companion.pdf"
curl --fail --silent --show-error \
  "$api_url/v1/projects/$typed_id/companion.txt" >"$workdir/companion.txt"
for persona in casual compact scholar; do
  pdfinfo "$workdir/persona-$persona.pdf" | grep -F '(A4)' >/dev/null
  if pdf_contains_text "$workdir/persona-$persona.pdf" 'DRAFT - REVIEW REQUIRED'; then
    printf 'Final %s export still contains the draft watermark.\n' "$persona" >&2
    exit 1
  fi
done
grep -F 'Physics Notes — reviewed in the integration flow' "$workdir/companion.txt" >/dev/null

curl --fail --silent --show-error \
  -F "file=@$repo_root/fixtures/sample-handwritten.png;type=image/png" \
  "$api_url/v1/projects" >"$workdir/handwritten-created.json"
assert_json '.status == "needs_review" and .mimeType == "image/png"' "$workdir/handwritten-created.json"
assert_json '[.pages[].blocks[].source.extractor] | any(. == "tesseract")' "$workdir/handwritten-created.json"

handwritten_id="$(jq -r '.id' "$workdir/handwritten-created.json")"
handwritten_revision="$(jq -r '.revision' "$workdir/handwritten-created.json")"
curl --fail --silent --show-error -X DELETE \
  "$api_url/v1/projects/$handwritten_id?expectedRevision=$handwritten_revision" >/dev/null
curl --fail --silent --show-error -X DELETE \
  "$api_url/v1/projects/$typed_id?expectedRevision=6" >/dev/null

curl --fail --silent --show-error "$api_url/v1/projects?limit=10&offset=0" >"$workdir/projects-final.json"
assert_json '.total == 0 and (.items | length) == 0' "$workdir/projects-final.json"

printf '%s\n' 'Integration smoke passed: web health, typed extraction, OCR, review, conflict handling, all A4 personas, companions, and deletion.'
