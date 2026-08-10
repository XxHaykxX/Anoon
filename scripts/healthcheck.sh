#!/bin/bash
# Сторожевая проверка companion. Только лог, без перезапуска: автолечение прячет настоящую поломку.
URL="${1:-https://5-129-206-152.sslip.io/api/health}"
LOG=/var/backups/anoon/health.log
# Внешний dead-man's switch (healthchecks.io и совместимые): пингуем ТОЛЬКО когда всё
# хорошо. Сервер, который лёг целиком, ничего не напишет в свой же лог и никого не
# позовёт — поэтому решение о тревоге принимает сторона снаружи, по молчанию.
# URL лежит в файле, а не в git: он сам по себе секрет (кто его знает — глушит алерт).
PING="${HEALTHCHECK_PING_URL:-}"
[ -z "$PING" ] && [ -r /etc/anoon-healthcheck-ping ] && PING=$(head -n1 /etc/anoon-healthcheck-ping | tr -d '[:space:]')

out=$(curl -sS -m 10 -w $'\n%{http_code}' "$URL" 2>&1) || true
code=$(printf %s "$out" | tail -n1)
body=$(printf %s "$out" | head -n -1 | tr -d "\n" | head -c 200)
if [ "$code" != "200" ] || ! printf %s "$body" | grep -q '"status":"ok"'; then
  echo "$(date -Is) DOWN http=${code:-none} url=$URL body=${body:-<none>}" >> "$LOG"
  [ -n "$PING" ] && curl -fsS -m 10 --retry 3 -o /dev/null \
    --data-raw "http=${code:-none} body=${body:-<none>}" "$PING/fail" || true
else
  [ -n "$PING" ] && curl -fsS -m 10 --retry 3 -o /dev/null "$PING" || true
fi
