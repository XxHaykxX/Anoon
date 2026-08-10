# syntax=docker/dockerfile:1
#
# Build the anoon server + DB initializer FROM SOURCE (PostgreSQL adapter).
# This produces a self-owned, extensible image (edit Go code in ../server, rebuild)
# instead of pulling the prebuilt release binary. Reuses the upstream env-driven
# config.template + entrypoint.sh so behaviour matches the official image.
#
# Build context = the cloned Tinode source (../server).

# ---- Stage 1: compile from source ----
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git build-base
WORKDIR /src
COPY . .
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -tags postgres -ldflags "-s -w -X main.buildstamp=anoon-src" -o /out/tinode ./server \
 && go build -tags postgres -ldflags "-s -w" -o /out/init-db ./tinode-db

# ---- Stage 2: runtime ----
FROM alpine:3.22
RUN apk update && apk add --no-cache ca-certificates bash grep netcat-openbsd
WORKDIR /opt/tinode

# Source-built binaries.
COPY --from=build /out/tinode /out/init-db ./
# Upstream env-driven config generator + entrypoint (unchanged behaviour).
COPY docker/tinode/config.template docker/tinode/entrypoint.sh ./
# Sample-data credential helper (used only when SAMPLE_DATA is set).
COPY tinode-db/credentials.sh ./
# Email/SMS templates the server renders at runtime.
COPY server/templ ./templ
# Optional sample data (Tino bot + demo users).
COPY tinode-db/data.json ./data.json

RUN mkdir -p /botdata /var/log \
 && sed -i 's/\r$//' entrypoint.sh credentials.sh config.template \
 && chmod +x entrypoint.sh credentials.sh

# Runtime env defaults (mirrors upstream docker/tinode/Dockerfile so config.template
# and entrypoint.sh get valid values — empty bools would break flag parsing / JSON).
# Static web client is bind-mounted at runtime (EXT_STATIC_DIR=/opt/tinode/static).
ENV WAIT_FOR= \
    # `rest` auth handler target — companion, which brokers Google sign-in.
    # It carries a default because the handler refuses to initialize on a
    # non-absolute server_url, and a Tinode that will not start is a worse
    # failure than a rest scheme nobody calls. The real value (with the shared
    # secret in userinfo) comes from compose; see companion's POST /auth/rest.
    REST_AUTH_URL='http://companion:8080/auth/rest' \
    RESET_DB=false \
    UPGRADE_DB=false \
    NO_DB_INIT=false \
    SAMPLE_DATA=data.json \
    DEFAULT_COUNTRY_CODE=US \
    PLUGIN_PYTHON_CHAT_BOT_ENABLED=false \
    MEDIA_HANDLER=fs \
    FS_CORS_ORIGINS='["*"]' \
    AWS_CORS_ORIGINS='["*"]' \
    AWS_ACCESS_KEY_ID= \
    AWS_SECRET_ACCESS_KEY= \
    AWS_REGION= \
    AWS_S3_BUCKET= \
    AWS_S3_ENDPOINT= \
    SMTP_HOST_URL='http://localhost:6060' \
    SMTP_SERVER= \
    SMTP_PORT= \
    SMTP_SENDER= \
    SMTP_LOGIN= \
    SMTP_PASSWORD= \
    SMTP_AUTH_MECHANISM= \
    SMTP_HELO_HOST= \
    EMAIL_VERIFICATION_REQUIRED= \
    DEBUG_EMAIL_VERIFICATION_CODE= \
    SMTP_DOMAINS= \
    TLS_ENABLED=false \
    TLS_DOMAIN_NAME= \
    TLS_CONTACT_ADDRESS= \
    FCM_PUSH_ENABLED=false \
    FCM_API_KEY= \
    FCM_APP_ID= \
    FCM_SENDER_ID= \
    FCM_PROJECT_ID= \
    FCM_VAPID_KEY= \
    FCM_MEASUREMENT_ID= \
    FCM_INCLUDE_ANDROID_NOTIFICATION=true \
    TNPG_PUSH_ENABLED=false \
    TNPG_AUTH_TOKEN= \
    TNPG_ORG= \
    WEBRTC_ENABLED=false \
    ICE_SERVERS_FILE= \
    STORE_USE_ADAPTER=postgres \
    SERVER_STATUS_PATH= \
    ACC_GC_ENABLED=false \
    CLUSTER_SELF= \
    PPROF_URL=

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s \
  CMD nc -z localhost 6060 || exit 1

EXPOSE 6060 16060
ENTRYPOINT ["./entrypoint.sh"]
