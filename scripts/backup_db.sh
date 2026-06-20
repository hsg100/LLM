#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
OUT_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Copy .env.production.example to .env.production and fill it first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/fieldmap-$TS.sql.gz"

cd "$ROOT_DIR"

echo "Writing Postgres backup to $OUT_FILE"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip -9 > "$OUT_FILE"

chmod 600 "$OUT_FILE"
echo "Backup complete: $OUT_FILE"
echo "Copy it off the VPS, for example: scp user@your-vps:$OUT_FILE ./"
