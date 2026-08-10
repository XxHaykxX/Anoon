#!/usr/bin/env bash
# =============================================================================
# anoon — Hetzner VPS bootstrap + first deploy
#
# Target: a FRESH Hetzner Cloud CX32 (4 vCPU / 8 GB / 80 GB NVMe), Ubuntu 24.04
# LTS, run as root (or a sudoer). Safe to re-run: every step checks before it
# acts (idempotent-ish).
#
# WHAT IT DOES
#   1. OS hardening basics: unattended-upgrades, fail2ban, UFW (22/80/443 only)
#   2. Installs Docker Engine + compose plugin (official Docker apt repo)
#   3. Prepares /opt/anoon and verifies the code has been copied there
#   4. Creates .env from .env.prod.example on first run (then STOPS so you can
#      fill in real secrets — it will not deploy with CHANGE_ME placeholders)
#   5. Builds + starts the prod stack: docker compose -f compose.prod.yml up
#      (DB schemas migrate automatically: Tinode's init-db on first start,
#       the companion's embedded migrations on every start)
#   6. Prints post-deploy steps (DNS, ROOT bot promotion, smoke checks)
#
# WHAT IT NEVER DOES
#   - It contains NO secrets and never generates .env values for you.
#   - It does not configure DNS: point an A record for your DOMAIN at this
#     server's IP yourself (ideally BEFORE running, so HTTPS issues instantly).
#
# GETTING THE CODE ONTO THE SERVER (repo is not on a git remote yet), from the
# workstation:
#   rsync -av --exclude node_modules --exclude .next --exclude .env \
#       "server/" root@SERVER_IP:/opt/anoon/server/
#   rsync -av --exclude .env "server-stack/" root@SERVER_IP:/opt/anoon/server-stack/
#   rsync -av --exclude node_modules --exclude .next --exclude ".env*" \
#       "../frontend/" root@SERVER_IP:/opt/anoon/frontend/
#   rsync -av --exclude node_modules --exclude .next --exclude ".env*" \
#       "admin/" root@SERVER_IP:/opt/anoon/admin/
# Then on the server:
#   bash /opt/anoon/server-stack/deploy-hetzner.sh
# =============================================================================
set -euo pipefail

ANOON_ROOT=/opt/anoon
STACK_DIR="$ANOON_ROOT/server-stack"
COMPOSE="docker compose -f $STACK_DIR/compose.prod.yml"

log()  { printf '\n\033[1;33m== %s ==\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (or via sudo)"

# -----------------------------------------------------------------------------
# 1. Base OS packages + hardening
# -----------------------------------------------------------------------------
log "1/6 OS packages + hardening"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades rsync

# Auto security updates for the host OS.
dpkg-reconfigure -f noninteractive unattended-upgrades

# fail2ban with defaults protects sshd out of the box.
systemctl enable --now fail2ban

# Firewall: ssh + http/https (caddy) + TURN (coturn). Everything else
# (postgres, tinode, grpc, companion) lives on the internal docker network and
# is never published.
# NOTE: docker publishes ports via iptables and BYPASSES ufw — the compose file
# publishing only caddy+coturn is the real boundary; these rules document it
# and stay correct if a service is ever switched to host networking.
# `ufw allow` is idempotent (re-adding an existing rule is a no-op), so this
# block safely runs on every invocation — including upgrades of existing hosts.
if ! ufw status | grep -q "Status: active"; then
  ufw default deny incoming
  ufw default allow outgoing
fi
ufw allow 22/tcp                 # SSH (keys only — disable password auth in sshd_config!)
ufw allow 80/tcp                 # ACME challenge + HTTP→HTTPS redirect
ufw allow 443/tcp                # HTTPS
ufw allow 443/udp                # HTTP/3 (QUIC)
ufw allow 3478/tcp               # TURN/STUN (coturn)
ufw allow 3478/udp               # TURN/STUN (coturn)
ufw allow 5349/tcp               # TURN over TLS
ufw allow 5349/udp               # TURN over DTLS
ufw allow 49160:49200/udp        # TURN relay range (must match turnserver.conf + compose)
ufw status | grep -q "Status: active" || ufw --force enable

# -----------------------------------------------------------------------------
# 2. Docker Engine + compose plugin (official repo — Ubuntu's is stale)
# -----------------------------------------------------------------------------
log "2/6 Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "docker already installed: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# -----------------------------------------------------------------------------
# 3. Code layout check
# -----------------------------------------------------------------------------
log "3/6 Code layout under $ANOON_ROOT"
mkdir -p "$ANOON_ROOT"
missing=0
for d in server server-stack frontend admin; do
  if [ ! -d "$ANOON_ROOT/$d" ]; then
    echo "  MISSING: $ANOON_ROOT/$d"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  die "copy the code first (see the rsync commands in this script's header)"
fi
[ -f "$STACK_DIR/compose.prod.yml" ] || die "compose.prod.yml not found in $STACK_DIR"

# -----------------------------------------------------------------------------
# 4. Prod .env
# -----------------------------------------------------------------------------
log "4/6 Prod .env"
if [ ! -f "$STACK_DIR/.env" ]; then
  cp "$STACK_DIR/.env.prod.example" "$STACK_DIR/.env"
  chmod 600 "$STACK_DIR/.env"
  cat <<'EOF'

  Created server-stack/.env from .env.prod.example.

  >>> STOP HERE. Edit /opt/anoon/server-stack/.env and fill in REAL values:
      - DOMAIN, ADMIN_DOMAIN (own DNS A record!), ACME_EMAIL,
        CORS_ALLOWED_ORIGINS
      - POSTGRES_PASSWORD, API_KEY_SALT (+ matching TINODE_API_KEY via keygen),
        AUTH_TOKEN_KEY, UID_ENCRYPTION_KEY
      - COMPANION_ROOT_SECRET, COMPANION_ADMIN_SECRET, VAPID keys
      - ADMIN_SESSION_SECRET *and* COMPANION_ADMIN_TOKEN_SECRET — the SAME
        value on both (attested admin mode; empty = legacy header trust)
      - SUPABASE_URL / SUPABASE_SECRET_KEY (admin operator accounts)
      - ADMIN_BASIC_AUTH_HASH:
          docker run --rm caddy:2-alpine caddy hash-password --plaintext '...'

  Fastest path — generate a full fresh set and paste it in:
      bash /opt/anoon/server-stack/rotate-secrets.sh generate
  (generation commands are also in the comments of .env itself)

  Then re-run this script — it will refuse to deploy while any CHANGE_ME
  placeholder remains.
EOF
  exit 0
fi
chmod 600 "$STACK_DIR/.env"
if grep -q "CHANGE_ME" "$STACK_DIR/.env"; then
  die ".env still contains CHANGE_ME placeholders — fill in real secrets first"
fi

# -----------------------------------------------------------------------------
# 5. Build + start the stack
# -----------------------------------------------------------------------------
log "5/6 docker compose up (build takes several minutes on first run)"
cd "$STACK_DIR"
# Migrations are automatic:
#  - postgres first-init creates the `anoon` DB (initdb/10-create-anoon-db.sql)
#  - Tinode's entrypoint runs init-db → creates + seeds the `tinode` DB schema
#  - the companion applies its embedded SQL migrations at startup
$COMPOSE up -d --build

echo
$COMPOSE ps

# -----------------------------------------------------------------------------
# 6. Next steps
# -----------------------------------------------------------------------------
log "6/6 Post-deploy checklist"
DOMAIN_VAL="$(grep -E '^DOMAIN=' "$STACK_DIR/.env" | cut -d= -f2-)"
ADMIN_DOMAIN_VAL="$(grep -E '^ADMIN_DOMAIN=' "$STACK_DIR/.env" | cut -d= -f2-)"
SERVER_IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<EOF

  1. DNS: A records  ${DOMAIN_VAL:-<DOMAIN>}  and  ${ADMIN_DOMAIN_VAL:-<ADMIN_DOMAIN>}  ->  ${SERVER_IP}
     (both are needed — Caddy issues a certificate per hostname. If not done
      yet, it retries automatically once DNS resolves; watch it with:
      $COMPOSE logs -f caddy)

  2. Health checks:
       curl -sSf https://${DOMAIN_VAL:-<DOMAIN>}/api/health        # companion
       curl -sSI https://${DOMAIN_VAL:-<DOMAIN>}/                  # frontend
       curl -sSI https://${ADMIN_DOMAIN_VAL:-<ADMIN_DOMAIN>}/      # admin -> expect 401
       $COMPOSE ps                                # all services healthy/up

  3. ROOT bot (one-time, after first start):
       a) register the account:
          curl -sS -X POST https://${DOMAIN_VAL:-<DOMAIN>}/api/auth/register \\
            -H 'Content-Type: application/json' \\
            -d '{"login":"<COMPANION_ROOT_LOGIN>","password":"<COMPANION_ROOT_SECRET>","gender":"male"}'
       b) promote it to ROOT inside the tinode container:
          docker exec anoon-prod-tinode ./init-db --make_root <the uid from (a)> \\
            --config /opt/tinode/tinode.conf
       c) restart the companion so it logs in as ROOT:
          $COMPOSE restart companion

  4. TURN relay (coturn) for calls behind NAT:
       a) once Caddy has its certificate, restart coturn so TLS on 5349 loads:
          $COMPOSE restart coturn
       b) verify with Trickle ICE (https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/):
          add  turn:${DOMAIN_VAL:-<DOMAIN>}:3478  + TURN_USER/TURN_PASS from .env,
          Gather candidates → a row of type "relay" must appear.

  5. Admin panel (one-time): create the first operator (argon2id hash stored,
     never the plaintext) — see DEPLOY-PROD.md "Админка: бутстрап":
       $COMPOSE exec -e ADMIN_EMAIL='you@example.com' \\
         -e ADMIN_PASSWORD='<strong>' -e ADMIN_ROLE=super_admin \\
         admin node scripts/create-admin.mjs
     Then log in at https://${ADMIN_DOMAIN_VAL:-<ADMIN_DOMAIN>}/ (basic-auth first,
     then the panel's own login) and open the reports list — it loading means
     companion accepted the attested operator token.

  6. Backups (do this BEFORE inviting users):
       - Hetzner console: enable server Backups (+20%)
       - nightly pg_dump of both DBs + anoon_uploads to Object Storage
         (see DEPLOY-PROD.md §Backups)

  7. Uptime monitoring: point UptimeRobot/BetterStack at
       https://${DOMAIN_VAL:-<DOMAIN>}/api/health

  Update later:   cd $STACK_DIR && docker compose -f compose.prod.yml up -d --build
  Logs:           cd $STACK_DIR && docker compose -f compose.prod.yml logs -f [service]

EOF
