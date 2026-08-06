package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrSubscriptionOwned is returned by SavePushSubscription when the endpoint is
// already registered to a different user and the caller could not prove it owns
// the device. Callers must surface this rather than swallow it: a browser that
// believes push is on when it is not is worse than a visible failure.
var ErrSubscriptionOwned = errors.New("store: push endpoint belongs to another account")

// PushSub is one registered Web Push subscription (a browser/device endpoint).
type PushSub struct {
	ID       int64
	UserID   int64
	Endpoint string
	P256dh   string
	Auth     string
}

// SavePushSubscription upserts a subscription for userID, keyed by endpoint.
// Re-subscribing the same browser/device (a fresh PushManager.subscribe(), e.g.
// after the keys rotate) replaces the stored keys rather than erroring.
//
// A row may change hands, because a push subscription belongs to the browser
// rather than to the account: when a second person signs in on a shared device,
// their subscribe legitimately presents the endpoint the first person
// registered. But `endpoint` is UNIQUE and was previously the whole conflict
// key, which made possession of the endpoint STRING sufficient to re-point
// somebody else's subscription — and an endpoint is not a secret we control
// (it is handed to the push service and quoted in logs). Posting a victim's
// endpoint silently moved their row to the attacker and stopped every
// notification they should have received: the same harm the unsubscribe path
// was scoped to prevent, through the neighbouring door.
//
// So a takeover now requires proof of possession — the presented keys must
// match the ones on file. A genuine re-subscribe from that device knows them;
// somebody who only scraped the endpoint does not. Updating your OWN row is
// always allowed, so key rotation on your own device is unaffected.
//
// Returns ErrSubscriptionOwned when the endpoint is another user's and the keys
// do not match. The client's remedy is to unsubscribe and subscribe again,
// which mints a fresh endpoint that inserts cleanly.
func (s *Store) SavePushSubscription(ctx context.Context, userID int64, endpoint, p256dh, auth string) error {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE
		SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
		WHERE push_subscriptions.user_id = EXCLUDED.user_id
		   OR (push_subscriptions.p256dh = EXCLUDED.p256dh
		       AND push_subscriptions.auth = EXCLUDED.auth)
		RETURNING id`,
		userID, endpoint, p256dh, auth,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		// The conflicting row survived the WHERE, so nothing was written and no
		// row came back: the endpoint is someone else's and the keys did not
		// match. Never a silent success.
		return ErrSubscriptionOwned
	}
	if err != nil {
		return fmt.Errorf("store: save push subscription: %w", err)
	}
	return nil
}

// DeletePushSubscription removes a subscription by endpoint. Idempotent:
// deleting an unknown endpoint is a harmless no-op. Server-side path only —
// the push sender calls it when a subscription has gone stale (404/410 from
// the push service), where the endpoint comes from our own table rather than
// from a request. A caller-supplied endpoint goes through
// DeletePushSubscriptionOf instead.
func (s *Store) DeletePushSubscription(ctx context.Context, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	if err != nil {
		return fmt.Errorf("store: delete push subscription: %w", err)
	}
	return nil
}

// DeletePushSubscriptionOf removes one of userID's own subscriptions. It backs
// POST /push/unsubscribe: the endpoint arrives in the request body, so the
// delete is scoped to the caller — knowing (or guessing) somebody else's
// endpoint must not silence their notifications. Idempotent, and silent when
// the endpoint belongs to another user: the caller learns nothing either way.
func (s *Store) DeletePushSubscriptionOf(ctx context.Context, userID int64, endpoint string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, endpoint, userID)
	if err != nil {
		return fmt.Errorf("store: delete push subscription of user %d: %w", userID, err)
	}
	return nil
}

// PushSubscriptionsByGender returns registered subscriptions across all users,
// optionally filtered to owners of a given gender. It backs the admin broadcast
// (#117): gender "male"/"female" targets that audience (join to users.gender);
// gender "" returns every subscription (the unfiltered "to all" broadcast).
// Ordered by id for a stable, resumable-feeling iteration.
func (s *Store) PushSubscriptionsByGender(ctx context.Context, gender string) ([]PushSub, error) {
	query := `SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
		FROM push_subscriptions ps`
	var args []any
	if gender != "" {
		query += ` JOIN users u ON u.id = ps.user_id WHERE u.gender = $1`
		args = append(args, gender)
	}
	query += ` ORDER BY ps.id`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: push subscriptions by gender: %w", err)
	}
	defer rows.Close()

	var out []PushSub
	for rows.Next() {
		var p PushSub
		if err := rows.Scan(&p.ID, &p.UserID, &p.Endpoint, &p.P256dh, &p.Auth); err != nil {
			return nil, fmt.Errorf("store: scan push subscription: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PushSubscriptionsFor returns every subscription registered for userID (a
// user may have several: phone + desktop browser, etc.).
func (s *Store) PushSubscriptionsFor(ctx context.Context, userID int64) ([]PushSub, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, endpoint, p256dh, auth
		FROM push_subscriptions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("store: push subscriptions for user %d: %w", userID, err)
	}
	defer rows.Close()

	var out []PushSub
	for rows.Next() {
		var p PushSub
		if err := rows.Scan(&p.ID, &p.UserID, &p.Endpoint, &p.P256dh, &p.Auth); err != nil {
			return nil, fmt.Errorf("store: scan push subscription: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
