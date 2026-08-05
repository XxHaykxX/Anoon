# anoon — production deploy runbook (Hetzner CX32)

One small VPS runs the whole stack behind a single domain with automatic HTTPS.
Architecture and cost rationale: `../DEPLOY-PLAN.md`. This file is the
*hands-on* runbook for the artifacts in this directory.

## The pieces

| File | Purpose |
|---|---|
| `compose.prod.yml` | Prod compose: caddy + frontend + companion + tinode + postgres + coturn. Public ports: caddy 80/443, coturn 3478/5349/49160-49200. |
| `Caddyfile.prod` | Single-origin reverse proxy + automatic Let's Encrypt: `/api/*`→companion, `/v0/*`→tinode, else→frontend. |
| `coturn/turnserver.conf` | TURN relay config (WebRTC calls behind NAT): auth, quotas, relay range, denied internal peer ranges. |
| `.env.prod.example` | Template for the server's `.env` — every var documented, placeholders only. |
| `deploy-hetzner.sh` | Bootstrap script for a fresh Ubuntu 24.04 VPS (docker, ufw, fail2ban, first `up -d --build`). |
| `initdb/10-create-anoon-db.sql` | Creates the companion's `anoon` DB on first postgres init (tinode's own init-db creates the `tinode` DB). |
| `companion/Dockerfile` | Already prod-grade (multi-stage → distroless, non-root) — reused as-is. |
| `../../frontend/Dockerfile.prod` | Frontend prod image with `NEXT_PUBLIC_*` build args (the generic `Dockerfile` can't bake them). |

Single-origin model: the browser only ever talks to `https://<DOMAIN>` — the
same pattern as the phone-test proxy (`Caddyfile.phone`), so the frontend runs
with `NEXT_PUBLIC_SAME_ORIGIN=1` and no backend hostnames are baked in.

## Prerequisites

1. **Domain** purchased; you can create DNS records for it.
2. **Hetzner** account; create a **CX32** (Nuremberg/Falkenstein — ~57 ms from
   Yerevan), **Ubuntu 24.04 LTS**, with your SSH key.
3. **DNS A record** `<DOMAIN>` → server IP (do it first; HTTPS then works
   immediately on first start).
4. Local workstation with `rsync` + ssh access to the server.

## First deploy

```bash
# 0. From the workstation — copy the three code trees to the server:
rsync -av --exclude node_modules --exclude .next --exclude .env \
    "server/"        root@SERVER_IP:/opt/anoon/server/
rsync -av --exclude .env \
    "server-stack/"  root@SERVER_IP:/opt/anoon/server-stack/
rsync -av --exclude node_modules --exclude .next --exclude ".env*" \
    "../frontend/" root@SERVER_IP:/opt/anoon/frontend/

# 1. On the server — bootstrap (installs docker, firewall, creates .env):
ssh root@SERVER_IP
bash /opt/anoon/server-stack/deploy-hetzner.sh
#    → first run stops after creating .env from the template.

# 2. Fill in real secrets (generation commands are inside the file):
nano /opt/anoon/server-stack/.env
#    Key rotation notes:
#    - API_KEY_SALT: new value + matching client api-key from Tinode's keygen
#      (go build ./keygen in ../server) → TINODE_API_KEY. Do this BEFORE launch.
#    - UID_ENCRYPTION_KEY: set once, NEVER change after users exist.

# 3. Re-run — builds images and starts everything:
bash /opt/anoon/server-stack/deploy-hetzner.sh
```

Then follow the checklist the script prints: verify
`https://<DOMAIN>/api/health`, register + promote the ROOT bot
(`init-db --make_root`), restart the companion.

**Prod safety already wired into `compose.prod.yml`:** `COMPANION_DEV_AUTH=0`
and `SAMPLE_DATA=""` are hard-coded (not env-overridable), `ENV=prod`,
CORS narrowed via `CORS_ALLOWED_ORIGINS` + `FS_CORS_ORIGINS`, no database or
gRPC port reachable from outside.

## Updating

```bash
# From the workstation: rsync the changed tree(s) again (step 0 above), then:
ssh root@SERVER_IP
cd /opt/anoon/server-stack
docker compose -f compose.prod.yml up -d --build   # rebuilds/restarts only what changed
```

- Tinode restarts in seconds; clients auto-reconnect.
- **Tinode version bump with schema change:** backup first, then one-off
  `UPGRADE_DB=true docker compose -f compose.prod.yml up -d tinode`, then set
  it back to `false` in `.env`.
- Companion schema migrations run automatically at startup.
- Changed `TINODE_API_KEY`/salt → the **frontend image must be rebuilt** (the
  key is baked in at build time): `docker compose -f compose.prod.yml build frontend`.

## Rollback

Images are built locally, so keep the previous code tree until the new one is
verified. Two options:

1. **Code rollback:** rsync the previous tree back, `up -d --build` again.
2. **Image tag rollback (better, once images are pushed to GHCR):** retag
   the compose `image:` entries to the previous tag and `up -d` — no rebuild.
   (Publishing `anoon-*:v<N>` tags to a private GHCR is the planned next step —
   see DEPLOY-PLAN §7.)

Database: schema rollbacks are not automated — restore from the nightly dump
if a migration must be undone. **Always `pg_dump` before an upgrade.**

## Backups (do before inviting users)

1. **Nightly cron on the host**: `pg_dump` of both DBs + the uploads volume,
   pushed off-machine (restic/rclone → Hetzner Object Storage):
   ```bash
   docker exec anoon-prod-db pg_dump -U postgres -Fc tinode > tinode-$(date +%F).dump
   docker exec anoon-prod-db pg_dump -U postgres -Fc anoon   > anoon-$(date +%F).dump
   docker run --rm -v anoon-prod_anoon_uploads:/u -v /root/backup:/b alpine \
     tar czf /b/uploads-$(date +%F).tgz -C /u .
   ```
2. **Hetzner Backups** (server snapshots, +20% of server price) — enable in
   the console for whole-machine restore.
3. **Test a restore** on a clean stand before launch — an untested backup is
   not a backup.

## DNS / HTTPS notes

- Caddy gets and renews Let's Encrypt certs automatically; requirement is just
  DNS pointing here and ports 80+443 open (the script's ufw rules do that).
- Certs + the ACME account live in the `caddy_data` volume — don't delete it,
  or reissuing may hit Let's Encrypt rate limits.
- If Cloudflare fronts the DNS, keep the record **DNS-only (grey cloud)** at
  least for launch — proxying WebSockets through CF adds failure modes.
- Watch issuance on first boot: `docker compose -f compose.prod.yml logs -f caddy`.

## TURN relay (coturn) — calls behind NAT

Most WebRTC calls connect peer-to-peer (STUN is enough), but ~10–20% of pairs
— symmetric NAT, strict mobile carriers, common on Armenian mobile networks —
can only talk through a relay. Without TURN those calls **never establish**.

- **Ports (published by coturn itself — TURN is not HTTP, cannot go through
  Caddy):** `3478` tcp+udp (STUN/TURN), `5349` tcp+udp (TURN over TLS/DTLS),
  `49160-49200/udp` relay range. The range is narrow on purpose (~40 concurrent
  relayed streams ≈ ~20 worst-case calls); to scale, widen it in **three**
  places together: `coturn/turnserver.conf` (min/max-port), `compose.prod.yml`
  (ports), `deploy-hetzner.sh` (ufw rule).
- **Auth:** one static user (`TURN_USER`/`TURN_PASS` in `.env`), long-term
  credential mechanism. The same values are baked into the frontend bundle
  (`NEXT_PUBLIC_TURN_*`) — i.e. **public by design**; abuse is bounded
  server-side (global quota, 3 Mbit/s per session, no relaying into private/
  metadata IP ranges). If leech traffic ever shows up: rotate the password
  (rebuild frontend) or upgrade to `use-auth-secret` + companion-minted
  ephemeral credentials.
- **TLS on 5349:** reuses the Let's Encrypt cert from Caddy's `caddy_data`
  volume (read-only mount). On the very first boot the cert doesn't exist yet —
  coturn logs a cert error but still serves plain TURN on 3478; run
  `docker compose -f compose.prod.yml restart coturn` once Caddy has issued.
  After each cert renewal (~60 days) coturn picks the new file up on its next
  restart; a monthly `restart coturn` cron is a cheap way to stay current.
- **Verify:** open <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>,
  add server `turn:<DOMAIN>:3478` with `TURN_USER`/`TURN_PASS`, press *Gather
  candidates* — a candidate of type **relay** must appear. Test `turns:<DOMAIN>:5349`
  the same way once TLS is up. No relay row = check ufw/ports/creds and
  `docker compose -f compose.prod.yml logs coturn` (look for `401` = wrong
  creds, or allocation errors = relay range/NAT problems).

## Not covered here (known gaps)

- **Admin panel container** (`admin.<domain>` + basic-auth) — deferred; add as
  a fourth backend in `Caddyfile.prod` + a service in compose when it ships.
- **GHCR image publishing / CI** — currently images build on the server itself.
- **S3 media storage** — start on the `fs` handler + volume; switch
  `MEDIA_HANDLER=s3` when the disk passes ~50% (see DEPLOY-PLAN §4).
