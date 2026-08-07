package store

// subscriptions.go reads the monetization row (subscriptions: tier, coins,
// expires_at) for display. Writes belong to the payment flow, which does not
// exist yet — see docs/PAYMENTS-PLAN.md.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Wallet is what the owner of an account may see about their own monetization
// state: the coin balance and the tier that is actually in force right now.
type Wallet struct {
	Coins int64
	Tier  string
}

// WalletOf returns userID's balance and effective tier.
//
// "Effective" is the whole point: a paid tier whose expires_at has passed reads
// back as free, exactly as Priority already treats it when ordering the match
// queue. Reporting the stored tier instead would put the two in disagreement —
// the profile would show Premium while the queue quietly treated the user as
// free, which is the shape of complaint nobody can reproduce. A missing row is
// free with no coins: every account starts without one, and it is created on
// first purchase.
func (s *Store) WalletOf(ctx context.Context, userID int64) (Wallet, error) {
	var tier string
	var coins int64
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT tier, coins, expires_at FROM subscriptions WHERE user_id = $1`, userID,
	).Scan(&tier, &coins, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Wallet{Tier: tierFree}, nil
	}
	if err != nil {
		// Free/0 alongside the error, not a zero Wallet: the caller (handleMe)
		// reports what it got even on failure, and an empty tier string is not a
		// value the frontend's SubscriptionTier union knows how to render.
		return Wallet{Tier: tierFree}, fmt.Errorf("store: wallet of user %d: %w", userID, err)
	}
	if expiresAt.Valid && expiresAt.Time.Before(time.Now()) {
		tier = tierFree // lapsed: the coins survive, the perks do not
	}
	return Wallet{Coins: coins, Tier: tier}, nil
}

// tierFree is the tier an account has without a paid subscription. It matches
// the subscriptions.tier CHECK constraint in 0001_init.sql, and the frontend's
// SubscriptionTier union.
const tierFree = "free"
