// Package push sends Web Push notifications (VAPID) to browsers that have
// registered a PushSubscription (POST /push/subscribe). It is a thin wrapper
// around github.com/SherClockHolmes/webpush-go plus the companion's own
// subscription storage (internal/store).
//
// The service is safe to use unconfigured: when no VAPID keypair is set,
// Send/SendPush becomes a no-op that logs once, so the companion runs fine
// without push wired up (e.g. local dev).
package push

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"

	"anoon/companion/internal/store"
)

// PushPayload is the JSON body delivered to the browser's service worker
// (decoded there and shown via the Notifications API). Field names are frozen:
// the frontend's service-worker `push` handler decodes these exactly.
type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Url   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// Service sends Web Push notifications using a VAPID keypair. Construct via
// New; a Service with an empty keypair is a valid, disabled instance — every
// exported method treats a nil *Service as disabled too, so callers never need
// a nil check before use.
type Service struct {
	store      *store.Store
	publicKey  string
	privateKey string
	subject    string

	warnOnce sync.Once
}

// New builds a push Service. publicKey/privateKey empty => disabled (SendPush
// logs once and returns; PublicKey reports ""). subject is the VAPID "sub"
// claim (e.g. "mailto:admin@anoon.app").
func New(st *store.Store, publicKey, privateKey, subject string) *Service {
	return &Service{store: st, publicKey: publicKey, privateKey: privateKey, subject: subject}
}

// Enabled reports whether a VAPID keypair is configured.
func (s *Service) Enabled() bool {
	return s != nil && s.publicKey != "" && s.privateKey != ""
}

// PublicKey returns the VAPID public key for GET /push/vapid, "" when unset.
func (s *Service) PublicKey() string {
	if s == nil {
		return ""
	}
	return s.publicKey
}

// SendPush delivers payload to every subscription registered for userID.
// Best-effort: delivery failures are logged, never returned — a push hiccup
// must not break the caller's request flow (friend request, match, etc.).
// Subscriptions the push service reports gone (404/410) are deleted so we stop
// retrying a dead endpoint.
func (s *Service) SendPush(ctx context.Context, userID int64, payload PushPayload) {
	if s == nil {
		return
	}
	if !s.Enabled() {
		s.warnOnce.Do(func() {
			log.Printf("push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset; push notifications disabled")
		})
		return
	}

	subs, err := s.store.PushSubscriptionsFor(ctx, userID)
	if err != nil {
		log.Printf("push: load subscriptions for user %d: %v", userID, err)
		return
	}
	subs = webPushOnly(subs)
	if len(subs) == 0 {
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("push: marshal payload: %v", err)
		return
	}

	for _, sub := range subs {
		_ = s.sendOne(ctx, body, sub)
	}
}

// Broadcast delivers payload to every registered subscription, optionally
// narrowed to one gender's subscribers. It is the admin broadcast (#117) — an
// announcement push — where gender "male"/"female" targets that audience and ""
// reaches everyone. Returns how many deliveries succeeded vs failed (a stale
// 404/410 endpoint is pruned and counted as failed). Disabled/error paths
// return (0,0).
func (s *Service) Broadcast(ctx context.Context, payload PushPayload, gender string) (sent, failed int) {
	if s == nil {
		return 0, 0
	}
	if !s.Enabled() {
		s.warnOnce.Do(func() {
			log.Printf("push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset; push notifications disabled")
		})
		return 0, 0
	}

	subs, err := s.store.PushSubscriptionsByGender(ctx, gender)
	if err != nil {
		log.Printf("push: load subscriptions for broadcast (gender=%q): %v", gender, err)
		return 0, 0
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("push: marshal broadcast payload: %v", err)
		return 0, 0
	}

	for _, sub := range webPushOnly(subs) {
		if err := s.sendOne(ctx, body, sub); err != nil {
			failed++
		} else {
			sent++
		}
	}
	return sent, failed
}

// webPushOnly drops the phone subscriptions from subs.
//
// A phone's Expo push token shares this table with the browsers, stored as
// `endpoint: "expo:ExponentPushToken[…]"` so that unsubscribe, pruning and
// account deletion keep working unchanged. Delivering it is the Expo branch's
// job (internal/api/expopush.go); webpush would only fail to decode the keys and
// log a line per phone per push. Skipped, not counted: Broadcast's sent/failed
// tally is about web deliveries, and the Expo branch counts its own.
func webPushOnly(subs []store.PushSub) []store.PushSub {
	out := subs[:0:0] // fresh backing array — never alias the caller's slice
	for _, sub := range subs {
		if !strings.HasPrefix(sub.Endpoint, "expo:") {
			out = append(out, sub)
		}
	}
	return out
}

// sendOne delivers body to a single subscription and removes it if the push
// service reports it is no longer valid. It returns nil on a successful (2xx)
// delivery, or an error describing the failure (transport error, a pruned
// stale endpoint, or a non-2xx status) — used by Broadcast to tally sent/failed
// and ignored by the best-effort SendPush.
func (s *Service) sendOne(ctx context.Context, body []byte, sub store.PushSub) error {
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             60,
	})
	if err != nil {
		log.Printf("push: send to %s: %v", sub.Endpoint, err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		if err := s.store.DeletePushSubscription(ctx, sub.Endpoint); err != nil {
			log.Printf("push: delete stale subscription %s: %v", sub.Endpoint, err)
		}
		return fmt.Errorf("push: subscription gone (%d)", resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		// Logged, not just returned: SendPush discards this error by design, so
		// without a log a rejected delivery (403 = VAPID key mismatch, 400 =
		// malformed payload) is invisible everywhere except an admin broadcast's
		// failed count — which reads as "push silently does nothing" instead of
		// "the push service is rejecting us".
		log.Printf("push: delivery to %s rejected (%d)", sub.Endpoint, resp.StatusCode)
		return fmt.Errorf("push: delivery failed (%d)", resp.StatusCode)
	}
	return nil
}
