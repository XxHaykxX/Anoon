#!/bin/bash
# Сторожевая проверка companion. Только лог, без перезапуска: автолечение прячет настоящую поломку.
URL="${1:-https://5-129-206-152.sslip.io/api/health}"
LOG=/var/backups/anoon/health.log
out=$(curl -sS -m 10 -w $'\n%{http_code}' "$URL" 2>&1) || true
code=$(printf %s "$out" | tail -n1)
body=$(printf %s "$out" | head -n -1 | tr -d "\n" | head -c 200)
if [ "$code" != "200" ] || ! printf %s "$body" | grep -q '"status":"ok"'; then
  echo "$(date -Is) DOWN http=${code:-none} url=$URL body=${body:-<none>}" >> "$LOG"
fi
