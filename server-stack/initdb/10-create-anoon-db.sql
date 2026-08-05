-- Runs ONCE, on the first boot of an empty postgres volume
-- (postgres:16-alpine executes /docker-entrypoint-initdb.d/*.sql at initdb).
--
-- The companion service migrates its own schema at startup but connects to an
-- already-existing `anoon` database — this creates it. The `tinode` database is
-- NOT created here: Tinode's own init-db does that on its first run.
CREATE DATABASE anoon;
