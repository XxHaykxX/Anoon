#!/bin/bash
# Дамп всего кластера (anoon + tinode + роли) из контейнера db, gzip, ротация 14 последних.
set -euo pipefail
# Дамп несёт хеши паролей ролей и все данные пользователей, а сервер общий —
# читать его может только root. umask стоит ДО создания .part: иначе секрет
# успевает полежать доступным всем в промежутке между записью и chmod.
umask 077
DIR=/var/backups/anoon
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/anoon-$(date +%Y%m%d-%H%M).sql.gz"
TMP="$OUT.part"
trap "rm -f \"$TMP\"" EXIT

docker exec anoon-prod-db pg_dumpall -U postgres | gzip -9 > "$TMP"
gunzip -t "$TMP"
# пустой/обрезанный дамп хуже отсутствия бэкапа
size=$(gzip -dc "$TMP" | wc -c)
if [ "$size" -lt 10000 ] || ! gzip -dc "$TMP" | tail -5 | grep -q "PostgreSQL database cluster dump complete"; then
  echo "$(date -Is) FAIL dump incomplete (uncompressed $size bytes)" >&2
  exit 1
fi
mv "$TMP" "$OUT"
trap - EXIT
ls -1t "$DIR"/anoon-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "$(date -Is) OK $OUT $(stat -c%s "$OUT") bytes gz / $size raw, kept $(ls -1 "$DIR"/anoon-*.sql.gz | wc -l)"
