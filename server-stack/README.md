# anoon — self-hosted Tinode server stack (from source)

Reproducible, self-owned anoon backend, **built from the Go source** in `../server`
(cloned `github.com/tinode/chat` @ **v0.25.2**). Because it compiles from source, you can
edit the server code and rebuild — the foundation for anoon's custom logic.

## What's here
- `Dockerfile` — multi-stage build: compiles `tinode` + `init-db` (PostgreSQL adapter) from
  source, then a slim Alpine runtime reusing the upstream env-driven `entrypoint.sh` + `config.template`.
- `docker-compose.yml` — `postgres:16-alpine` + `tinode` (built here) on host ports **6061** (HTTP/API)
  and **16061** (gRPC). Does NOT clash with a demo Tinode on 6060.
- `.env` — secrets (secure `AUTH_TOKEN_KEY`, `UID_ENCRYPTION_KEY`, DB password). **Not committed.**

## Run
```bash
cd server-stack
docker compose up -d --build      # build from source + start
docker compose logs -f tinode     # watch init + startup
```
- API/web:  http://localhost:6061/
- gRPC:     localhost:16061  (for the anoon extension service)
- Health:   `docker compose ps` (tinode healthcheck on :6060 inside container)

DB lifecycle:
```bash
RESET_DB=true  docker compose up -d   # wipe + re-init schema
UPGRADE_DB=true docker compose up -d   # migrate schema after a version bump
```

## Ports vs the existing demo
The old demo container (`TINODE`, image `tinode/tinode-postgres:latest`) stays on 6060 and is
untouched. This stack is independent (own image `anoon-tinode:0.25.2`, own volumes
`anoon_pgdata` / `anoon_uploads`). Retire the demo once this is validated.

## Security notes
- `AUTH_TOKEN_KEY` + `UID_ENCRYPTION_KEY` are freshly generated (not the well-known demo keys).
- `API_KEY_SALT` is left at the upstream default so the bundled web client's baked-in api-key
  still validates. To fully rotate: build `keygen` from source, generate a new api-key with the
  new salt, and update the client's api-key.
- TLS/push/SMTP are disabled by default — enable via env in `docker-compose.yml` for production.

## Extending for anoon (no core fork needed)
Tinode exposes a gRPC API + plugin firehose (`../server/pbx/model.proto`, example in
`../server/chatbot/`). anoon business logic — roulette matchmaking, `#ID` anonymous identity,
profile-reveal→friends, ratings, report/moderation, view-once media — lives in a **companion
service** that talks to Tinode over gRPC (`:16061`) and keeps its own tables. Core stays stock,
so upgrades are painless. If deeper hooks are ever required, the source is right here to fork.
