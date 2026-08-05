#!/usr/bin/env bash
# Re-apply the Anoon (anoon DS) theme onto the running TINODE container.
# The theme is now a real build (not a CSS hack). Sources of truth:
#   css/base.css (+ merged anoon layer), css/anoon-components.css,
#   src/** (config.js dark default, logo-view.jsx brand, contacts-view.jsx empty state),
#   img/anoon-logo.svg, brand PNGs in img/.
#
# Usage:  bash apply-anoon-theme.sh        # rebuild + push into running TINODE
set -e
cd "$(dirname "$0")"

CID=TINODE
S=/opt/tinode/static

# 1. Build
npm run build:css  >/dev/null 2>&1
npm run build:prod >/dev/null 2>&1

# 2. Backup container static once
docker exec "$CID" sh -c "cd /opt/tinode && [ -f static.orig.tar ] || tar cf static.orig.tar static"

# 3. Deploy built files (NOT firebase-init.js — server-owned)
docker cp index.html       "$CID:$S/index.html"
docker cp manifest.json    "$CID:$S/manifest.json"
docker cp css/base.min.css "$CID:$S/css/base.min.css"
docker cp img/anoon-logo.svg "$CID:$S/img/logo.svg"
for p in logo32x32 logo96 logo192; do docker cp img/$p.png "$CID:$S/img/$p.png"; done
for f in umd/*.prod.js; do docker cp "$f" "$CID:$S/umd/"; done

echo "Anoon theme applied. Hard-refresh http://localhost:6060 (Ctrl+Shift+R)."

# --- Persistence across container RECREATION (docker rm) ---
# A baked image exists: tinode-anoon:latest (deploy/Dockerfile).
# Rebuild it after changes:   cd ../deploy && docker build -t tinode-anoon:latest .
# Recreate the server from it (replaces base tinode image):
#   docker rm -f TINODE
#   docker run -p 6060:6060 -d --name TINODE --network tinode-net --restart always \
#     --env POSTGRES_DSN="postgres://postgres:postgres@postgres:5432/tinode?sslmode=disable&connect_timeout=10" \
#     tinode-anoon:latest
#
# --- Revert to stock Tinode look ---
#   docker exec TINODE sh -c 'cd /opt/tinode && tar xf static.orig.tar'
