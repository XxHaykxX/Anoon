# anoon companion service

Greenfield Go backend for anoon. It sits beside Tinode in the `server-stack`
compose project and owns everything Tinode does not: auth brokering, the #ID
counter, roulette matching, friends, reports/moderation state, and a realtime
event channel to the frontend. It talks to Tinode as a **ROOT gRPC client**.

This is phase **A2**: it compiles, runs, connects to Postgres, applies
migrations, opens the ROOT-bot stream, and serves `/health`. The first
end-to-end slice is live — `POST /auth/register` creates a Tinode account over
the ROOT gRPC stream, allocates the next sequential five-digit **#ID**, and
stores the UID↔#ID mapping. The remaining routes are still 501 stubs. See
`PLAN.md` for the full design and build order.

## Layout

```
companion/
  go.mod                     module anoon/companion (Go 1.23)
  main.go                    config -> db -> migrate -> ROOT bot -> HTTP; graceful shutdown
  Dockerfile                 multi-stage: golang:1.23-alpine build -> distroless/static runtime
  .dockerignore
  internal/
    config/config.go         env loading (COMPANION_*, TINODE_GRPC_ADDR)
    db/db.go                 pgx/v5 stdlib over database/sql + embedded migration runner
    db/migrations/
      0001_init.sql          users, friendships, reports, roulette_queue, subscriptions
    tinode/client.go         ROOT-bot gRPC: dial, {hi}+{login}, read loop, reconnect,
                             request/ctrl correlation, CreateAccount (live); ban/mute/reveal stubs
    store/users.go           anoon DB access: #ID allocation (hash_id_seq) + UID mapping
    store/oauth.go           oauth_identities + pending_registrations access
    oauth/google.go          Google ID-token verifier (tokeninfo); unit-tested
    api/router.go            net/http mux (Go 1.22 method routing)
    api/handlers.go          /health + JSON/error helpers + 501 stubs
    api/auth.go              POST /auth/register (basic) + POST /auth/oauth/google broker
    api/rest.go              POST /auth/rest: Tinode `rest`-scheme callback (Google)
    api/ws.go                /ws gorilla/websocket upgrade + keepalive
    pbx/                     VENDORED copy of Tinode's generated gRPC contract
      model.pb.go            (see "pbx import approach" below)
      model_grpc.pb.go
```

## Key decisions

- **pbx import approach — vendored copy.** Tinode's `pbx` package lives in the
  `github.com/tinode/chat` module, whose dependency graph is huge (mongo,
  rethinkdb, aws, firebase). Importing it via a `replace` directive would drag
  all of that into `go mod tidy`. Instead we copied the two generated files
  (`model.pb.go`, `model_grpc.pb.go`) into `internal/pbx` (package name kept as
  `pbx`). They depend only on `google.golang.org/grpc` + `.../protobuf`, so the
  build stays light. The `.proto` contract is fixed, so drift is a non-issue; if
  Tinode regenerates it, re-copy the two files.
- **DB driver — `github.com/jackc/pgx/v5/stdlib`** over `database/sql`. Modern,
  pure Go (CGO-free static binary), and `database/sql` keeps the tiny migration
  runner simple. Connection pool via `sql.DB`.
- **Migrations — homegrown, no library.** SQL files under `db/migrations/` are
  embedded with `go:embed` and applied in lexical order, each in its own tx,
  tracked in `schema_migrations`. Add `0002_*.sql`, etc. Runs on every startup.
- **WebSocket lib — `github.com/gorilla/websocket`.** Same lib Tinode already
  uses (v1.5.3), battle-tested, simple upgrade path.
- **ROOT bot** authenticates with the `basic` scheme, secret = `login:password`.
  The account must be flagged via `tinode-db --make_root`.

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `ENV` | `prod` | `dev` or `prod`. Gates `COMPANION_DEV_AUTH` (refuses to start if both are set) and `CORS_ALLOWED_ORIGINS` (required, no `*`, when `prod`). Defaults to `prod` so a missing value fails closed — **local runs must set `ENV=dev` explicitly** |
| `COMPANION_ADDR` | `:8080` | HTTP + WS bind address |
| `COMPANION_DB_DSN` | *(required)* | Postgres DSN for the `anoon` database |
| `TINODE_GRPC_ADDR` | `tinode:16060` | Tinode Node gRPC endpoint (in-network) |
| `COMPANION_ROOT_LOGIN` | | ROOT bot login |
| `COMPANION_ROOT_SECRET` | | ROOT bot password |
| `COMPANION_GOOGLE_CLIENT_ID` | *(empty)* | Google OAuth client id (`aud`); empty disables Google sign-in |
| `COMPANION_DEV_AUTH` | `0` | Enables the `X-Anoon-Uid`/`X-Anoon-Hash-Id` auth bypass. DEV ONLY — `Load` refuses to start if this is on while `ENV=prod` |
| `COMPANION_ADMIN_SECRET` | *(empty)* | Shared secret for the `/admin/*` API (`X-Companion-Admin-Secret`). Empty disables the admin surface (`503`) |
| `COMPANION_ADMIN_TOKEN_SECRET` | *(empty)* | **Optional.** HMAC key for per-operator admin tokens (`X-Admin-Token`); must equal the admin UI's `ADMIN_SESSION_SECRET`. Empty = **legacy mode, the shipped default** — operator id/role come from the `X-Admin-Id`/`X-Admin-Role` headers and are asserted by the caller, so `super_admin` is a UI guardrail rather than a privilege boundary. Setting it makes both attested (see `adminIdentity` in `internal/api/admin.go`). Whitespace is trimmed; when set it must be **≥16 characters** or `Load` refuses to start, matching the bound the admin service enforces |
| `COMPANION_REST_SECRET` | *(empty)* | Shared secret Tinode must present on `POST /auth/rest`, the server-to-server hook its `rest` auth scheme calls for Google sign-in. Empty disables the hook (`503`). Accepted as the `X-Companion-Rest-Secret` header or as the basic-auth password — Tinode cannot set headers, so it carries the secret as userinfo in its configured `server_url`. Use a hex value (it lives inside a URL) |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated origin allowlist (exact origin or `*.suffix` wildcard). Empty defaults to localhost + `*.trycloudflare.com` outside prod; required (no `*`) when `ENV=prod` |
| `RATE_LIMIT_RPS` | `0` | Token-bucket refill rate (req/s, per user + per IP) on the public endpoints (auth, roulette enqueue, reports, friend search). `0`/unset disables rate limiting (lenient default); `429` + `Retry-After` when exceeded |
| `RATE_LIMIT_BURST` | `max(2*RPS,10)` | Token-bucket depth (largest instantaneous burst). Only meaningful when `RATE_LIMIT_RPS>0` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | *(empty)* / `587` / *(empty)* / *(empty)* / `no-reply@anoon.app` | Outbound email for password reset / email verification (#116). **Currently stubbed** — emails are logged, not sent; these are placeholders so a real SMTP transport can be wired into `internal/mail` with no other change |

## Build & run locally (without Docker)

```sh
cd server-stack/companion
go mod tidy          # generates go.sum, fills indirect deps
go build ./...
# ENV is REQUIRED locally: it defaults to "prod", which refuses to start
# without an explicit CORS_ALLOWED_ORIGINS (and with the dev auth bypass on).
ENV=dev \
COMPANION_DB_DSN="postgres://postgres:pass@localhost:5432/anoon?sslmode=disable" \
  ./companion
```

`GET http://localhost:8080/health` -> `{"status":"ok","service":"companion",...}`.

## docker-compose service block

Paste this into `server-stack/docker-compose.yml` under `services:` (orchestrator
owns that file). It reuses the existing `db` Postgres and the `tinode` service by
name on the default project network. Host port **6062 -> 8080**.

```yaml
  companion:
    build:
      context: ./companion
    image: anoon-companion:0.1
    container_name: anoon-companion
    depends_on:
      db:
        condition: service_healthy
      tinode:
        condition: service_started
    environment:
      COMPANION_ADDR: ":8080"
      COMPANION_DB_DSN: "postgres://postgres:${POSTGRES_PASSWORD}@db:5432/anoon?sslmode=disable&connect_timeout=10"
      TINODE_GRPC_ADDR: "tinode:16060"
      COMPANION_ROOT_LOGIN: ${COMPANION_ROOT_LOGIN}
      COMPANION_ROOT_SECRET: ${COMPANION_ROOT_SECRET}
    ports:
      - "6062:8080"
    restart: unless-stopped
```

### Prerequisite: the `anoon` database must exist

The Postgres container only auto-creates the `postgres` DB, and Tinode creates
`tinode`. Nothing creates `anoon` yet, so the companion's first connection will
fail until it exists. Options (orchestrator's call):

1. Add an init script mounted at `/docker-entrypoint-initdb.d/` on the `db`
   service that runs `CREATE DATABASE anoon;` (only runs on a fresh volume), or
2. One-off: `docker compose exec db psql -U postgres -c "CREATE DATABASE anoon;"`.

The companion runs its own table migrations once the database exists.
