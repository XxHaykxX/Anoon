-- 0016_billing.sql — money around the subscriptions row (#14, docs/PAYMENTS-PLAN.md §4.1).
--
-- `subscriptions` (0001_init.sql) already models the entitlement state: tier,
-- expires_at and the coin balance. It is deliberately left as the hot-path
-- cache (Store.Priority reads it on every enqueue); coin_ledger below is the
-- append-only source of truth, written in the SAME transaction as the balance.
--
-- No provider has been chosen yet (PAYMENTS-PLAN §5-6), so nothing here names
-- one: `provider` is free text and the only thing schema-level idempotency
-- relies on is (provider, provider_ref) being unique.

-- ---------------------------------------------------------------------------
-- products: the catalogue, moved off the frontend's hardcoded constants
-- (frontend/src/store/walletStore.ts COIN_PACKS / SUBSCRIPTION_PLANS).
-- Prices are the BUSINESS-PLAN §3 draft figures, verbatim — changing them is a
-- row update here, not a redeploy of the client.
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    code        TEXT      PRIMARY KEY,
    -- 'coins' = one-off pack, 'sub' = a period of a paid tier.
    kind        TEXT      NOT NULL CHECK (kind IN ('coins','sub')),
    tier        TEXT      CHECK (tier IN ('premium','super_premium')),
    period_days INT       CHECK (period_days > 0),
    coins       BIGINT    NOT NULL DEFAULT 0 CHECK (coins >= 0),
    price_amd   BIGINT    NOT NULL CHECK (price_amd > 0),
    active      BOOLEAN   NOT NULL DEFAULT TRUE,
    -- A subscription needs a tier and a period; a coin pack needs neither.
    CHECK ((kind = 'sub') = (tier IS NOT NULL AND period_days IS NOT NULL))
);

INSERT INTO products (code, kind, tier, period_days, coins, price_amd) VALUES
    ('coins_50',         'coins', NULL,            NULL,  50,   490),
    ('coins_150',        'coins', NULL,            NULL,  150, 1290),
    ('coins_400',        'coins', NULL,            NULL,  400, 2990),
    ('coins_1000',       'coins', NULL,            NULL, 1000, 4900),
    ('premium_1m',       'sub',   'premium',         30,    0, 1990),
    ('super_premium_1m', 'sub',   'super_premium',   30,    0, 4990);

-- ---------------------------------------------------------------------------
-- orders: one purchase attempt. amount_amd is copied from the product at
-- creation time so a later price change cannot retroactively re-price an order
-- that is already out with the payer — and so the webhook has something of our
-- own to compare the callback's amount against (§4.2 rule 4).
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_code TEXT        NOT NULL REFERENCES products(code),
    provider     TEXT        NOT NULL,
    amount_amd   BIGINT      NOT NULL CHECK (amount_amd > 0),
    status       TEXT        NOT NULL DEFAULT 'new'
                             CHECK (status IN ('new','pending','paid','failed','expired','refunded')),
    -- The provider's own id for the payment. NULL until a callback names one.
    provider_ref TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    paid_at      TIMESTAMPTZ
);

-- The idempotency key (§4.2 rule 3): a retried callback carrying the same
-- provider payment id can never open a second paid order.
CREATE UNIQUE INDEX orders_provider_ref_uidx
    ON orders (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
-- Feeds the "stuck in pending" admin view and any future status poller.
CREATE INDEX orders_open_idx ON orders (status, expires_at) WHERE status IN ('new','pending');

-- ---------------------------------------------------------------------------
-- payment_events: every callback body we ever receive, written BEFORE it is
-- trusted (§4.2 rule 1) — including the ones whose signature does not verify
-- and the ones we cannot parse. This is the only record that survives a
-- dispute, so nothing here is conditional on the event being valid.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_events (
    id           BIGSERIAL   PRIMARY KEY,
    provider     TEXT        NOT NULL,
    -- NULL when the callback did not name an order we know (unparseable body,
    -- forged signature, stale id). ON DELETE SET NULL keeps the audit row.
    order_id     UUID        REFERENCES orders(id) ON DELETE SET NULL,
    raw          JSONB       NOT NULL,
    signature_ok BOOLEAN     NOT NULL,
    -- Why the event did or did not result in a grant, in plain words.
    note         TEXT        NOT NULL DEFAULT '',
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_received_idx ON payment_events (received_at DESC);
CREATE INDEX payment_events_order_idx ON payment_events (order_id) WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- coin_ledger: append-only history of every coin movement. Corrections are new
-- rows with the opposite sign, never updates.
-- ---------------------------------------------------------------------------
CREATE TABLE coin_ledger (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta      BIGINT      NOT NULL,
    reason     TEXT        NOT NULL CHECK (reason IN
                           ('purchase','bonus','boost','gift','super_rating','limit_off','admin','refund')),
    order_id   UUID        REFERENCES orders(id) ON DELETE SET NULL,
    ref        JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The second half of idempotency: even if the orders UPDATE guard were ever
-- bypassed, one order can grant its coins exactly once.
CREATE UNIQUE INDEX coin_ledger_grant_uidx
    ON coin_ledger (user_id, reason, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX coin_ledger_user_idx ON coin_ledger (user_id, created_at DESC);

-- The last line of defence for the spend path that does not exist yet (§4.4):
-- a balance can never go negative, whatever application code claims.
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_coins_nonneg CHECK (coins >= 0);
