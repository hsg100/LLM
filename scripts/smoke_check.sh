#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
BASE_URL=""

usage() {
  cat <<'EOF'
Usage: scripts/smoke_check.sh [--url URL]
       scripts/smoke_check.sh [URL]

Run deploy-time smoke checks against the production API.

Options:
  --url URL   Override the API base URL or domain.
  -h, --help  Show this help.

If no URL is provided, API_DOMAIN is read from .env.production.
EOF
}

fail() {
  echo "ERROR: $*" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      if [ "$#" -lt 2 ]; then
        fail "--url requires a value"
        exit 2
      fi
      BASE_URL="$2"
      shift 2
      ;;
    --url=*)
      BASE_URL="${1#--url=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      fail "unknown option: $1"
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$BASE_URL" ]; then
        fail "only one URL may be provided"
        exit 2
      fi
      BASE_URL="$1"
      shift
      ;;
  esac
done

if [ -z "$BASE_URL" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    fail "missing env file: $ENV_FILE"
    fail "provide --url or create .env.production with API_DOMAIN set."
    exit 1
  fi
  BASE_URL="$(grep -E '^API_DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)"
fi

if [ -z "$BASE_URL" ]; then
  fail "API_DOMAIN is empty; provide --url or set API_DOMAIN in $ENV_FILE"
  exit 1
fi

case "$BASE_URL" in
  http://*|https://*) ;;
  *) BASE_URL="https://$BASE_URL" ;;
esac
BASE_URL="${BASE_URL%/}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
FAILURES=0

request() {
  local path="$1"
  local body_file="$2"
  local err_file="$3"
  local status

  status="$(curl -sS --connect-timeout 5 --max-time 20 -o "$body_file" -w '%{http_code}' "$BASE_URL$path" 2>"$err_file")" || return $?
  printf '%s' "$status"
}

json_value() {
  local body_file="$1"
  local field="$2"

  if command -v jq >/dev/null 2>&1; then
    jq -er ".$field" "$body_file"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$body_file" >/dev/null
    python3 - "$body_file" "$field" <<'PY'
import json
import sys

path, field = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
value = data
for part in field.split("."):
    value = value[part]
print(value)
PY
  else
    fail "JSON validation requires jq or python3"
    return 1
  fi
}

check_health() {
  local body="$TMP_DIR/health.body"
  local err="$TMP_DIR/health.err"
  local status
  local health_status

  if ! status="$(request "/health" "$body" "$err")"; then
    echo "FAIL /health"
    fail "/health request failed: $(tr '\n' ' ' < "$err")"
    return 1
  fi
  if [ "$status" != "200" ]; then
    echo "FAIL /health"
    fail "/health returned HTTP $status, expected 200"
    return 1
  fi
  if ! health_status="$(json_value "$body" "status" 2>/dev/null)" || [ "$health_status" != "ok" ]; then
    echo "FAIL /health"
    fail "/health JSON did not contain status == ok"
    return 1
  fi

  echo "PASS /health"
  return 0
}

check_ready() {
  local body="$TMP_DIR/ready.body"
  local err="$TMP_DIR/ready.err"
  local status
  local field
  local value

  if ! status="$(request "/ready" "$body" "$err")"; then
    echo "FAIL /ready"
    fail "/ready request failed: $(tr '\n' ' ' < "$err")"
    return 1
  fi
  if [ "$status" != "200" ]; then
    echo "FAIL /ready"
    fail "/ready returned HTTP $status, expected 200"
    return 1
  fi

  for field in db redis migrations; do
    if ! value="$(json_value "$body" "$field" 2>/dev/null)" || [ "$value" != "ok" ]; then
      echo "FAIL /ready"
      fail "/ready JSON did not contain $field == ok"
      return 1
    fi
  done

  echo "PASS /ready"
  return 0
}

check_jobs() {
  local body="$TMP_DIR/jobs.body"
  local err="$TMP_DIR/jobs.err"
  local status

  if ! status="$(request "/api/jobs" "$body" "$err")"; then
    echo "FAIL /api/jobs"
    fail "/api/jobs request failed: $(tr '\n' ' ' < "$err")"
    return 1
  fi
  if [ "$status" != "200" ]; then
    echo "FAIL /api/jobs"
    fail "/api/jobs returned HTTP $status, expected 200"
    return 1
  fi

  echo "PASS /api/jobs"
  return 0
}

check_health || FAILURES=$((FAILURES + 1))
check_ready || FAILURES=$((FAILURES + 1))
check_jobs || FAILURES=$((FAILURES + 1))

if [ "$FAILURES" -gt 0 ]; then
  echo "FAIL smoke checks: $FAILURES failed"
  exit 1
fi

echo "PASS smoke checks"
