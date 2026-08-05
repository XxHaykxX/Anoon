package store

import (
	"context"
	"fmt"
)

// PushSub is one registered Web Push subscription (a browser/device endpoint).
type PushSub struct {
	ID       int64
	UserID   int64
	Endpoint string
	P256dh   string
	Auth     string
}

// SavePushSubscription upserts a subscription for userID, keyed by endpoint:
// re-subscribing the same browser/device (a fresh PushManager.subscribe() call,
// e.g. after the keys rotate) replaces the stored keys rather than erroring.
func (s *Store) SavePushSubscription(ctx context.Context, userID int64, endpoint, p256dh, auth string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE
		SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		userID, endpoint, p256dh, auth)
	if err != nil {
		return fmt.Errorf("store: save push subscription: %w", err)
	}
	return nil
}

// DeletePushSubscription removes a subscription by endpoint. Idempotent:
// deleting an unknown endpoint is a harmless no-op. Called both from the
// explicit unsubscribe endpoint and by the push sender when a subscription
// has gone stale (404/410 from the push service).
func (s *Store) DeletePushSubscription(ctx context.Context, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	if err != nil {
		return fmt.Errorf("store: delete push subscription: %w", err)
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
