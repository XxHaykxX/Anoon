-- 0006_push.sql — Web Push (VAPID) subscription storage.
--
-- One row per browser/device PushSubscription the client registers via
-- PushManager.subscribe(). endpoint is globally unique (it identifies the
-- push service + device) so re-subscribing the same device upserts in place
-- (see Store.SavePushSubscription). Deleting the owning user cascades.

CREATE TABLE push_subscriptions (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT        NOT NULL UNIQUE,
    p256dh     TEXT        NOT NULL,
    auth       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
