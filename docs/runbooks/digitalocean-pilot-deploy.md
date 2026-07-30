# DigitalOcean pilot deploy

This runbook deploys the current app to a **single DigitalOcean Droplet** for the planned
100-user field test. It is optimized for:

- lowest monthly cost
- one-box operational simplicity
- behavior that matches the codebase's current single-instance assumptions

## Target shape

- 1 DigitalOcean **Basic Droplet**, recommended size: **2 vCPU / 4 GB RAM / 80 GB SSD**
- Docker Compose on Ubuntu 24.04
- Caddy for TLS and reverse proxy
- 1 `web` container
- 1 `worker` container
- 1 `realtime` container
- 1 local Postgres container
- 1 local Redis container

## Why this shape

- The app keeps expensive dashboard reads in a **process-local cache**, so a single web instance
  avoids cross-instance staleness and invalidation gaps.
- Rate limiting is also **process-local**, which makes single-instance behavior more predictable.
- Export ZIPs are written by the worker to local disk and later served by the web app, so
  colocating both services on one host keeps exports simple and cheap.
- Realtime is a standalone WebSocket bridge backed by Postgres `LISTEN/NOTIFY`, so it needs its
  own container and signing secret in the env file.

## Files added for this flow

- `Dockerfile`
- `.dockerignore`
- `deploy/digitalocean/docker-compose.pilot.yml`
- `deploy/digitalocean/Caddyfile`
- `deploy/digitalocean/pilot.env.example`

## Important deploy choice

For this pilot, `pilot.env` uses:

- `NODE_ENV=production`
- `VS_DEPLOY_ENV=staging`

That is intentional.

The repository's env contract requires `REDIS_URL` to use `rediss://` only in the `production`
deploy tier. On a single low-cost Droplet, the simplest stack is local Redis without TLS.

Using `VS_DEPLOY_ENV=staging` keeps the strict security behaviors we care about for the pilot:

- secure cookies
- HTTPS-only public origin checks
- required `VS_PUBLIC_APP_ORIGIN`
- explicit proxy trust

If you later move to **managed TLS Redis** or add a local TLS Redis proxy, switch
`VS_DEPLOY_ENV` to `production`.

## 1. Provision the Droplet

Create a new Droplet with:

- Region close to test users
- Ubuntu 24.04 LTS
- Basic plan
- 2 vCPU / 4 GB RAM / 80 GB SSD
- SSH key auth only

Add a firewall with:

- inbound `22` from your IP
- inbound `80` from anywhere
- inbound `443` from anywhere
- no public inbound rules for Postgres or Redis

Cloudflare owns DNS for `716fm.com`. Point the root `A` record at the Droplet IP before
starting Caddy:

- Type: `A`
- Name: `@`
- Content: Droplet public IPv4
- Proxy status: proxied or DNS-only both work; proxied is fine with SSL mode **Full** or **Full (strict)**.

Do not create a DigitalOcean DNS zone for this domain unless DNS is moved away from Cloudflare.

## 2. Install Docker

SSH to the Droplet and install Docker Engine plus the Compose plugin.

Example:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in once after the group change.

## 3. Clone the repo and prepare env

```bash
git clone <your-repo-url> 716FM
cd 716FM
cp deploy/digitalocean/pilot.env.example deploy/digitalocean/pilot.env
```

Fill in `deploy/digitalocean/pilot.env` with real values.

Generate strong secrets with:

```bash
openssl rand -base64 36
```

Use that for:

- `POSTGRES_PASSWORD`
- `VS_INTERNAL_API_SECRET`

If `POSTGRES_PASSWORD` contains symbols, `DATABASE_URL` must use the URL-encoded form of the
same password. Generate it with:

```bash
POSTGRES_PASSWORD='paste-raw-password-here' python3 -c 'import os, urllib.parse; print("DATABASE_URL=postgresql://listen:" + urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe="") + "@postgres:5432/listen")'
```

## 4. Boot the data services and run migrations

Start Postgres and Redis first:

```bash
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  up -d postgres redis
```

Run migrations:

```bash
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  --profile ops run --rm migrate
```

## 5. Start the app

```bash
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  up -d --build web worker realtime caddy
```

Watch startup:

```bash
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  logs -f web worker realtime caddy
```

## 6. Smoke check

Verify:

- `https://<your-domain>/` loads
- signup works
- login works
- dashboard loads after auth
- importing from Last.fm creates a worker job and advances
- export creation completes and download works
- realtime handshake from `/api/me/listen-realtime` returns `enabled: true`
- WebSocket connection upgrades successfully through `wss://716fm.com`

Useful commands:

```bash
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml ps
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml logs --tail=200 web
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml logs --tail=200 worker
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml logs --tail=200 realtime
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml logs --tail=200 postgres
docker compose --env-file deploy/digitalocean/pilot.env -f deploy/digitalocean/docker-compose.pilot.yml logs --tail=200 redis
```

## 7. Backups for the pilot

The cheapest acceptable protection is:

- enable DigitalOcean Droplet backups
- also take a nightly Postgres dump off-box

Example nightly dump:

```bash
mkdir -p /var/backups/716fm
docker compose -f /path/to/716FM/deploy/digitalocean/docker-compose.pilot.yml exec -T postgres \
  pg_dump -U listen listen | gzip > /var/backups/716fm/listen-$(date +%F).sql.gz
```

Ship those dumps to Spaces, S3, or another machine if you want real separation from the Droplet.

## 8. Operational rules for the pilot

- Do not scale `web` above one instance.
- Do not expose Postgres or Redis publicly.
- Treat the worker as required infrastructure, not an optional helper.
- Keep export artifacts on the shared `export_artifacts` volume used by both `web` and `worker`.

## 9. Updating the deployment

```bash
git pull
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  up -d --build web worker realtime
```

If migrations changed:

```bash
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  --profile ops run --rm migrate
docker compose --env-file deploy/digitalocean/pilot.env \
  -f deploy/digitalocean/docker-compose.pilot.yml \
  up -d --build web worker realtime
```

## 10. When to move past this pilot stack

Move to a more durable setup when any of these become true:

- you need more than one web instance
- you need managed database failover
- you need managed Redis or TLS Redis in the true `production` tier
- export volume durability becomes a concern
- support load requires safer rollback and maintenance windows
