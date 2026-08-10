#!/usr/bin/env bash
# =============================================================================
# anoon — secret generation & rotation helper
#
#   ./rotate-secrets.sh generate          # fresh values for every secret
#   ./rotate-secrets.sh generate NAME...  # just these
#   ./rotate-secrets.sh plan              # rotation order, blast radius, restarts
#   ./rotate-secrets.sh selfcheck         # verify the generators (no secrets shown)
#
# It PRINTS to stdout and never touches .env — rotation is a decision, not an
# automation. Redirect to a file only if you understand it will contain live
# secrets:  ./rotate-secrets.sh generate > /root/new-secrets.txt && chmod 600 it.
#
# ponytail: no in-place .env rewriting. An editor + `plan` is safer than a sed
# script that can half-apply a rotation and leave the stack in a state where
# half the services hold the old key. Add it when rotations become routine.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="${SERVER_SRC:-$HERE/../server}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
command -v openssl >/dev/null || die "нужен openssl"

# ---- generators -------------------------------------------------------------
gen_b64()  { openssl rand -base64 "$1" | tr -d '\n'; }
gen_hex()  { openssl rand -hex "$1"; }

# The Tinode client api-key is DERIVED from API_KEY_SALT — the two only work as
# a pair, so they are always generated together. keygen lives in the Tinode
# source tree; without a Go toolchain we emit the salt and say what to run.
gen_api_pair() {
	local salt; salt="$(gen_b64 32)"
	echo "API_KEY_SALT=$salt"
	if command -v go >/dev/null && [ -d "$SERVER_SRC/keygen" ]; then
		local key
		key="$(cd "$SERVER_SRC" && go run ./keygen -salt="$salt" -sequence=1 2>/dev/null \
			| grep -oE '[A-Za-z0-9_+/=-]{30,}' | head -1)" || true
		if [ -n "${key:-}" ]; then
			echo "TINODE_API_KEY=$key"
			return
		fi
	fi
	echo "TINODE_API_KEY=  # ЗАПУСТИ: cd $SERVER_SRC && go run ./keygen -salt='<соль выше>' -sequence=1"
}

gen_vapid() {
	if command -v npx >/dev/null; then
		local out
		out="$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)" || true
		if [ -n "${out:-}" ]; then
			echo "VAPID_PUBLIC_KEY=$(printf '%s' "$out"  | grep -oE '"publicKey":"[^"]+' | cut -d'"' -f4)"
			echo "VAPID_PRIVATE_KEY=$(printf '%s' "$out" | grep -oE '"privateKey":"[^"]+' | cut -d'"' -f4)"
			return
		fi
	fi
	echo "VAPID_PUBLIC_KEY=   # ЗАПУСТИ: npx web-push generate-vapid-keys"
	echo "VAPID_PRIVATE_KEY="
}

# The admin session key is ONE value living under TWO names: the panel signs
# operator sessions with it, the companion verifies them with it. Emitting them
# as a pair is the whole point — a mismatch 401s every admin request.
gen_admin_pair() {
	local k; k="$(gen_b64 32)"
	echo "ADMIN_SESSION_SECRET=$k"
	echo "COMPANION_ADMIN_TOKEN_SECRET=$k"
}

emit() {
	case "$1" in
	POSTGRES_PASSWORD)       echo "POSTGRES_PASSWORD=$(gen_hex 24)" ;;
	API_KEY_SALT|TINODE_API_KEY) gen_api_pair ;;
	AUTH_TOKEN_KEY)          echo "AUTH_TOKEN_KEY=$(gen_b64 32)" ;;
	UID_ENCRYPTION_KEY)      echo "UID_ENCRYPTION_KEY=$(gen_b64 16)" ;;
	COMPANION_ROOT_SECRET)   echo "COMPANION_ROOT_SECRET=$(gen_b64 24)" ;;
	COMPANION_ADMIN_SECRET)  echo "COMPANION_ADMIN_SECRET=$(gen_b64 24)" ;;
	ADMIN_SESSION_SECRET|COMPANION_ADMIN_TOKEN_SECRET) gen_admin_pair ;;
	COMPANION_REST_SECRET)   echo "COMPANION_REST_SECRET=$(gen_hex 32)" ;;
	TURN_PASS)               echo "TURN_PASS=$(gen_hex 16)"
	                         echo "NEXT_PUBLIC_TURN_PASS=  # то же значение, что TURN_PASS" ;;
	VAPID)                   gen_vapid ;;
	*) die "неизвестный секрет: $1" ;;
	esac
}

ALL=(POSTGRES_PASSWORD API_KEY_SALT AUTH_TOKEN_KEY UID_ENCRYPTION_KEY
     COMPANION_ROOT_SECRET COMPANION_ADMIN_SECRET ADMIN_SESSION_SECRET
     COMPANION_REST_SECRET TURN_PASS VAPID)

cmd_generate() {
	echo "# anoon — свежие секреты, $(date -u +%FT%TZ). НЕ коммитить, chmod 600."
	echo "# Порядок применения и что перезапускать: ./rotate-secrets.sh plan"
	echo
	if [ "$#" -eq 0 ]; then
		for n in "${ALL[@]}"; do emit "$n"; done
	else
		for n in "$@"; do emit "$n"; done
	fi
	echo
	echo "# Не генерируется здесь (внешние системы):"
	echo "#   ADMIN_BASIC_AUTH_HASH — docker run --rm caddy:2-alpine caddy hash-password --plaintext '...'"
	echo "#   SUPABASE_SECRET_KEY   — из панели Supabase"
	echo "#   COMPANION_GOOGLE_CLIENT_ID — из Google Cloud Console (не секрет)"
}

# ---- plan -------------------------------------------------------------------
cmd_plan() {
cat <<'PLAN'
ПОРЯДОК РОТАЦИИ (сверху вниз — от безопасного к разрушительному)

Общая механика: правишь /opt/anoon/server-stack/.env, затем перезапускаешь
ТОЛЬКО перечисленные сервисы:
    docker compose -f compose.prod.yml up -d <сервис> ...
`up -d` пересоздаёт контейнер с новым окружением; `restart` — НЕ перечитывает
.env и оставит старое значение. Это самая частая ошибка в ротации.

--- Без даунтайма и без последствий для пользователей ---------------------
1) COMPANION_ADMIN_SECRET + ADMIN_SESSION_SECRET/COMPANION_ADMIN_TOKEN_SECRET
   Меняются ВМЕСТЕ (второй — одно значение под двумя именами).
   Перезапуск: companion, admin  (в один `up -d`, иначе окно рассинхрона)
   Эффект: операторы разлогинены, пользователи не затронуты.

2) ADMIN_BASIC_AUTH_HASH
   Перезапуск: caddy.  Эффект: браузеры операторов переспросят пароль.

3) COMPANION_REST_SECRET
   Значение встроено в rest server_url конфига Tinode — меняй в ОБОИХ местах.
   Перезапуск: companion, tinode.  Эффект: короткое окно, когда вход через
   Google отвечает 503. Делай в тихие часы.

4) TURN_PASS (+ NEXT_PUBLIC_TURN_PASS — то же значение)
   Порядок: сначала пересобрать фронт с новым значением, потом поднять coturn.
     docker compose -f compose.prod.yml build frontend
     docker compose -f compose.prod.yml up -d frontend coturn
   Эффект: звонки, идущие через relay ПРЯМО СЕЙЧАС, рвутся; новые — нет.
   Пока у пользователей закеширован старый бандл, их relay-звонки не
   соединятся: подожди цикл обновления service worker'а или смирись с окном.

--- С заметным эффектом для пользователей ---------------------------------
5) POSTGRES_PASSWORD
   Пароль живёт в трёх местах: сам postgres, DSN tinode, DSN companion.
   Даунтайм неизбежен (порядок важен):
     a) docker exec anoon-prod-db psql -U postgres -c \
          "ALTER USER postgres PASSWORD '<НОВЫЙ>';"
     b) поправить POSTGRES_PASSWORD в .env
     c) docker compose -f compose.prod.yml up -d tinode companion
   Сервис db пересоздавать НЕ нужно — POSTGRES_PASSWORD читается только при
   первичной инициализации тома, а не при каждом старте.
   Эффект: ~10–20 секунд, пока перезапускаются tinode и companion.

6) COMPANION_ROOT_SECRET
   Это пароль реальной учётки бота в Tinode — недостаточно поменять .env.
   Сначала смени пароль аккаунта в Tinode, потом .env, потом companion.
   Перезапуск: companion.  Эффект: до перезапуска companion не может
   действовать on_behalf_of — рулетка и модерация не работают.

7) AUTH_TOKEN_KEY
   Перезапуск: tinode.  Эффект: РАЗЛОГИНИВАЕТ ВСЕХ пользователей. Переживаемо,
   делать осознанно (компрометация ключа) и предупредив.

8) API_KEY_SALT + TINODE_API_KEY (пара, только вместе)
     docker compose -f compose.prod.yml build frontend
     docker compose -f compose.prod.yml up -d tinode frontend
   Эффект: старый бандл в браузерах перестаёт подключаться до обновления
   страницы. Делать ДО запуска — обязательно (см. ниже).

9) VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
   Перезапуск: companion.  Эффект: все существующие push-подписки становятся
   недействительны, пользователи должны переподписаться. Ротировать только при
   компрометации приватного ключа.

--- НИКОГДА не ротировать после появления пользователей -------------------
UID_ENCRYPTION_KEY — ключ обфускации uid. Смена ломает КАЖДЫЙ существующий
идентификатор пользователя (в т.ч. имена p2p-топиков). Задаётся один раз при
первом развёртывании. Если он скомпрометирован — это миграция данных, а не
ротация.

--- Обязательно ДО первого запуска ---------------------------------------
API_KEY_SALT/TINODE_API_KEY: дефолтная соль лежит в публичных исходниках
Tinode, а выведенный из неё api-key закоммичен в этом репозитории
(frontend/.env.local.example, frontend/TINODE-INTEGRATION.md). Прод обязан
стартовать уже с новой парой.

--- После ротации --------------------------------------------------------
- Обнови офлайн-копию .env в парольном менеджере.
- Проверь: https://<DOMAIN>/api/health отвечает 200; вход в приложение;
  вход в админку; отправка сообщения; relay-кандидат в trickle-ICE (если
  трогал TURN).
PLAN
}

# ---- selfcheck --------------------------------------------------------------
# Проверяет генераторы, а не секреты: длины и парность. Значения не печатаются.
cmd_selfcheck() {
	local v
	v="$(emit POSTGRES_PASSWORD)"
	[ "${#v}" -ge 66 ] || die "POSTGRES_PASSWORD короче ожидаемых 48 hex-символов"

	v="$(emit AUTH_TOKEN_KEY | cut -d= -f2-)"
	[ "${#v}" -ge 43 ] || die "AUTH_TOKEN_KEY короче 32 байт в base64"

	v="$(emit UID_ENCRYPTION_KEY | cut -d= -f2-)"
	[ "${#v}" -ge 22 ] || die "UID_ENCRYPTION_KEY короче 16 байт в base64"

	# Парность admin-ключа — единственная нетривиальная логика здесь.
	local pair a b
	pair="$(emit ADMIN_SESSION_SECRET)"
	a="$(printf '%s\n' "$pair" | grep '^ADMIN_SESSION_SECRET='          | cut -d= -f2-)"
	b="$(printf '%s\n' "$pair" | grep '^COMPANION_ADMIN_TOKEN_SECRET='  | cut -d= -f2-)"
	[ -n "$a" ] && [ "$a" = "$b" ] || die "admin-ключи разошлись — attested-режим не заработает"
	[ "${#a}" -ge 16 ] || die "admin-ключ короче минимума в 16 символов, обе стороны его отвергнут"

	# Два вызова подряд обязаны давать разные значения (иначе генератор сломан).
	[ "$(emit AUTH_TOKEN_KEY)" != "$(emit AUTH_TOKEN_KEY)" ] || die "генератор повторяется"

	echo "selfcheck: OK (длины и парность в порядке, значения не выводились)"
}

case "${1:-}" in
	generate)  shift; cmd_generate "$@" ;;
	plan)      cmd_plan ;;
	selfcheck) cmd_selfcheck ;;
	*) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
