# FieldMap VPS Backend Deployment

This guide deploys the FieldMap backend on a VPS so the Vercel frontend can call it at:

```txt
https://api.yourdomain.com
```

The Vercel app hosts `apps/web`. The VPS runs only the backend stack:

- Caddy reverse proxy with automatic HTTPS
- FastAPI API container
- RQ worker container
- PostgreSQL with pgvector
- Redis
- persistent PDF storage volume
- persistent generated FieldMap Research Git export volume

Do not point FieldMap export at your main Obsidian vault. Use a separate generated research repo/vault.

## Prerequisites

- Ubuntu 22.04 or 24.04 VPS
- A domain you control
- DNS access for `api.yourdomain.com`
- SSH key access to the VPS
- Docker Engine and Docker Compose plugin
- Vercel project for `apps/web`

Recommended VPS size for a small single-user deployment:

- 2 vCPU
- 4 GB RAM minimum
- 40+ GB disk, more if parsing many PDFs

## Install Docker

On a fresh Ubuntu VPS:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git ufw
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in, then verify:

```bash
docker --version
docker compose version
```

## Security Baseline

Configure the firewall:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Recommended SSH hardening:

- Use SSH keys only.
- Disable password login in `/etc/ssh/sshd_config`.
- Keep root login disabled.
- Install `fail2ban` if this VPS is exposed to the public internet.

Do not expose Postgres or Redis publicly. In `docker-compose.prod.yml`, they are only on the internal Docker network.

## Clone Repo

```bash
git clone https://github.com/YOUR_ORG_OR_USER/fieldmap.git
cd fieldmap
```

## Create Production Env

```bash
cp .env.production.example .env.production
nano .env.production
```

Set at minimum:

```txt
ENV=production
API_DOMAIN=api.yourdomain.com
ACME_EMAIL=admin@yourdomain.com
POSTGRES_PASSWORD=<long random password>
DATABASE_URL=postgresql+psycopg://fieldmap:<same password>@db:5432/fieldmap
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-vercel-app.vercel.app
LLM_PROVIDER=openai
LLM_MODEL_FAST=gpt-4o-mini
LLM_MODEL_STRONG=gpt-4o
OPENAI_API_KEY=<secret>
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
ENABLE_DEV_FALLBACK=false
ENABLE_EMBEDDING_DEV_FALLBACK=false
PDF_STORAGE_DIR=/data/pdfs
OBSIDIAN_EXPORT_REPO_PATH=/data/obsidian
# --- Auth (login is required in production) ---
AUTH_SECRET=<long random string>          # MUST set; signs session tokens
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<long random password>     # change from the default
DEMO_USER_EMAIL=demo@yourdomain.com
DEMO_USER_PASSWORD=<password>
```

Auth notes:

- `REQUIRE_AUTH` defaults to `true`; the UI blocks all entry until login and
  `POST /api/landscapes` / `DELETE /api/landscapes/{id}` require a valid token.
- The admin + demo accounts are seeded/updated from these env vars at API
  startup. Rotating `ADMIN_PASSWORD` and restarting updates the credential.
- Set a strong `AUTH_SECRET`. If left at the insecure default in production the
  API logs a loud warning at startup. Changing it invalidates existing tokens
  (everyone must log in again).
- Only the admin account can delete landscapes (used to clean up spam).

For Vercel preview deployments, either add each preview origin to `CORS_ALLOWED_ORIGINS`, or set `CORS_ALLOWED_ORIGIN_REGEX` to a tightly scoped Vercel pattern for your project/team. Do not use wildcard CORS in production.

Never commit `.env.production`.

## Configure DNS

Create DNS records:

```txt
Type: A
Name: api
Value: <your VPS IPv4 address>

Type: AAAA
Name: api
Value: <your VPS IPv6 address, if used>
```

Wait for DNS to resolve:

```bash
dig +short api.yourdomain.com
```

Caddy will request TLS certificates automatically after DNS points to the VPS and ports 80/443 are reachable.

## Start Services

```bash
make prod-up
```

Equivalent raw command:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Check containers:

```bash
make prod-ps
make prod-logs
```

The first startup initializes tables and enables pgvector.

## Verify API

From the VPS:

```bash
curl -fsS http://localhost/health
curl -fsS http://localhost/ready
```

From your laptop:

```bash
curl -fsS https://api.yourdomain.com/health
curl -fsS https://api.yourdomain.com/ready
```

Expected `/health`:

```json
{"status":"ok"}
```

Expected `/ready` should report:

```json
{
  "env": "production",
  "db": "ok",
  "redis": "ok",
  "migrations_startup": "ok",
  "migrations": "ok",
  "schema_rev": "<alembic revision>",
  "schema_head": "<alembic revision>"
}
```

`schema_rev` and `schema_head` must match. If `migrations` is `"stale"` (or `db`/`redis` isn't `"ok"`), `/ready` returns HTTP 503 even though `/health` may still report `{"status":"ok"}` — `/health` does not check schema state, only `/ready` does. Run `make prod-migrate` to bring the schema to head, then re-check.

Also check embeddings:

```bash
curl -fsS https://api.yourdomain.com/ready/embeddings
```

## Configure Vercel

In the Vercel project for `apps/web`, set:

```txt
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

`NEXT_PUBLIC_API_URL` is also supported for backwards compatibility, but new deployments should use `NEXT_PUBLIC_API_BASE_URL`.

Redeploy Vercel after changing env vars.

## First Remote Landscape Job

In the Vercel frontend:

1. Open the deployed frontend.
2. Create a landscape:
   - Topic: `RAG evaluation`
   - Max papers: `5`
   - Parse PDFs: enabled
3. Watch the job page.

Verify:

- Job progress updates over HTTPS.
- SSE works; polling remains as fallback.
- Worker processes search, ranking, PDFs, extraction, synthesis, quiz and flashcards.
- Paper pages show parsed sections where PDFs were available.
- Browser console has no CORS errors.

API checks:

```bash
curl -fsS https://api.yourdomain.com/api/jobs/<job_id>
curl -fsS https://api.yourdomain.com/api/landscapes/<landscape_id>
curl -fsS https://api.yourdomain.com/api/landscapes/<landscape_id>/graph
curl -fsS https://api.yourdomain.com/api/landscapes/<landscape_id>/export/preview
```

SSE smoke test:

```bash
curl -N https://api.yourdomain.com/api/jobs/<job_id>/events
```

You should see `event: progress` and a final `event: complete`.

## Obsidian Git Export

The production compose mounts a named volume at `/data/obsidian`. FieldMap writes:

```txt
/data/obsidian/FieldMap Research/
```

The exporter initializes a Git repo if needed, writes only changed files, commits, and optionally pushes.

Recommended production setup:

- Keep this generated vault separate from your main Obsidian vault.
- If you want pushes, set:

```txt
OBSIDIAN_EXPORT_GIT_REMOTE=git@github.com:YOUR_USER/fieldmap-research.git
OBSIDIAN_EXPORT_AUTO_PUSH=true
```

Then ensure the API/worker container can authenticate to that remote. For a first production pass, leaving auto-push off is simpler and safer.

Preview without writing:

```bash
curl -fsS https://api.yourdomain.com/api/landscapes/<landscape_id>/export/preview
```

Run export:

```bash
curl -fsS -X POST https://api.yourdomain.com/api/landscapes/<landscape_id>/export/obsidian \
  -H 'Content-Type: application/json' \
  --data '{"push": false}'
```

## Backups

Create a timestamped compressed database backup:

```bash
make prod-backup-db
```

Backups are written to:

```txt
backups/postgres/fieldmap-YYYYMMDDTHHMMSSZ.sql.gz
```

Copy backups off the VPS:

```bash
scp user@your-vps:/path/to/fieldmap/backups/postgres/fieldmap-*.sql.gz ./backups/
```

Also back up Docker volumes that contain:

- `pdf_storage`
- `obsidian_export`

Example archive:

```bash
docker run --rm \
  -v fieldmap_pdf_storage:/data/pdfs:ro \
  -v "$PWD/backups:/backup" \
  alpine tar czf /backup/pdf-storage-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data pdfs
```

Restore database backup:

```bash
make prod-down
make prod-up
gunzip -c backups/postgres/fieldmap-YYYYMMDDTHHMMSSZ.sql.gz | \
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

For a full destructive restore, create and test a dedicated restore runbook before relying on it in production.

## Common Operations

Update deployment:

```bash
git pull
make prod-up
```

View logs:

```bash
make prod-logs
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

Run schema initialization manually:

```bash
make prod-migrate
```

Stop:

```bash
make prod-down
```

## Remote Verification Checklist

- `https://api.yourdomain.com/health` returns `{"status":"ok"}`.
- `https://api.yourdomain.com/ready` reports `db: ok`, `redis: ok`, and `migrations: ok` (with `schema_rev == schema_head`).
- `https://api.yourdomain.com/ready/embeddings` returns `ok: true`.
- Vercel frontend loads.
- Vercel frontend can create a landscape.
- SSE or polling job progress works across HTTPS.
- Worker processes the job to `done`.
- PDFs download and parse where available.
- LLM calls work with the configured provider.
- `/api/landscapes/{id}` includes synthesis and field structure.
- `/api/landscapes/{id}/graph` returns paper relationship edges.
- Export preview returns planned files without writing.
- Obsidian Git export writes to `/data/obsidian/FieldMap Research`.
- Browser console has no CORS errors.
- Postgres and Redis ports are not reachable from the public internet.

## Troubleshooting

### Caddy cannot get a certificate

- Confirm `api.yourdomain.com` DNS points to the VPS.
- Confirm ports 80 and 443 are open in UFW and any cloud firewall.
- Check logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

### Browser CORS errors

- Add the exact Vercel frontend origin to `CORS_ALLOWED_ORIGINS`.
- Restart API:

```bash
make prod-up
```

- Avoid wildcard CORS in production.

### Worker does not process jobs

Check Redis and worker logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f redis worker
```

Verify `.env.production` has the same `REDIS_URL` for API and worker.

### Database not ready

Check:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f db api
```

Confirm `DATABASE_URL` password matches `POSTGRES_PASSWORD`.

### PDF storage fills disk

Inspect volume usage:

```bash
docker system df
docker volume ls
```

Move to a larger VPS disk or mount a dedicated volume for Docker data.

### Export fails

- Confirm `/data/obsidian` is writable by the container.
- Confirm the generated export vault is separate from your main Obsidian vault.
- If pushing, confirm Git remote auth from inside the container.

## Local Development Is Unchanged

Local development still uses:

```bash
docker compose up --build
```

The production deployment uses:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
