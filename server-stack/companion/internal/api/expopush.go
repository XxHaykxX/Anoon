package api

// expopush.go is the SECOND delivery branch for the same notifications the web
// already gets (#17 mobile). Web Push (VAPID, internal/push) can only reach a
// browser; an Expo app on a phone is woken through Expo's push service instead.
//
// Nothing about "кого будить" is duplicated here. Every decision — recipient is
// offline, sender is not muted or banned, the pair really is connected — stays
// exactly where it was (message_push.go, friends.go, roulette.go); this file
// only adds a second wire at the very end of it. The seam is sendPush below:
// callers that used to call s.Push.SendPush now call s.sendPush, and both device
// kinds are served by one call.
//
// Storage is deliberately the existing push_subscriptions table, not a second
// one: a phone token is just another endpoint the user registered. The row is
// marked by an "expo:" prefix on `endpoint`, and p256dh/auth carry the token
// itself — see handlePushSubscribe in push.go for why, and for the validation
// that keeps junk out of the table.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// expoEndpointPrefix marks a push_subscriptions row as an Expo device token
// rather than a Web Push endpoint. It is also what makes the row addressable by
// the existing unsubscribe/prune paths without a single store change.
const expoEndpointPrefix = "expo:"

// expoBatchMax is Expo's documented cap on tokens per request.
const expoBatchMax = 100

// expoPushURL is Expo's push service. A var rather than a const so the test can
// point it at a stub: companion has no config field for it, and inventing one
// would mean editing config/main.go, which this change does not own. There is
// no reason to override it in production.
//
// ponytail: package-level, so tests touching it cannot run in parallel. Move it
// onto Server if a second sender ever needs a different endpoint.
var expoPushURL = "https://exp.host/--/api/v2/push/send"

var expoHTTPClient = &http.Client{Timeout: 15 * time.Second}

// expoTokenRe matches the two shapes Expo hands out. Validated on the way IN
// (handlePushSubscribe) so the table never holds a string we would then post to
// exp.host on every message for the rest of the account's life.
var expoTokenRe = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9._:%+-]+\]$`)

// validExpoToken reports whether tok is a well-formed Expo push token.
func validExpoToken(tok string) bool {
	return len(tok) <= 256 && expoTokenRe.MatchString(tok)
}

// sendPush delivers one notification to every device the user registered:
// browsers over Web Push, phones over Expo. This is THE fan-out point — call it
// instead of s.Push.SendPush so a change of heart about who gets woken keeps
// applying to both.
//
// Best-effort on both branches, like Web Push always was: a push failure never
// propagates back into the request or the stream handler that triggered it.
func (s *Server) sendPush(ctx context.Context, userID int64, payload push.PushPayload) {
	s.Push.SendPush(ctx, userID, payload)
	s.sendExpoPush(ctx, userID, payload)
}

// broadcastPush is the same fan-out for the admin announcement (#117): the
// Web Push tally from push.Service plus the Expo one, added together so the
// admin sees how many devices were actually reached, not just browsers.
func (s *Server) broadcastPush(ctx context.Context, payload push.PushPayload, gender string) (sent, failed int) {
	sent, failed = s.Push.Broadcast(ctx, payload, gender)
	subs, err := s.Store.PushSubscriptionsByGender(ctx, gender)
	if err != nil {
		log.Printf("expo-push: load subscriptions for broadcast (gender=%q): %v", gender, err)
		return sent, failed
	}
	ok, bad := s.deliverExpo(ctx, expoTokensOf(subs), payload)
	return sent + ok, failed + bad
}

// sendExpoPush delivers payload to userID's Expo tokens, if they have any. A
// user with no phone registered costs one query and nothing else.
func (s *Server) sendExpoPush(ctx context.Context, userID int64, payload push.PushPayload) {
	subs, err := s.Store.PushSubscriptionsFor(ctx, userID)
	if err != nil {
		log.Printf("expo-push: load subscriptions for user %d: %v", userID, err)
		return
	}
	s.deliverExpo(ctx, expoTokensOf(subs), payload)
}

// expoTokensOf picks the Expo rows out of a mixed subscription list.
func expoTokensOf(subs []store.PushSub) []string {
	var out []string
	for _, sub := range subs {
		if tok, ok := strings.CutPrefix(sub.Endpoint, expoEndpointPrefix); ok && tok != "" {
			out = append(out, tok)
		}
	}
	return out
}

// deliverExpo posts payload to every token in batches of expoBatchMax and
// deletes the ones Expo reports as dead — the same pruning the Web Push sender
// does on a 404/410, and for the same reason: an uninstalled app leaves a token
// that would otherwise be retried forever.
func (s *Server) deliverExpo(ctx context.Context, tokens []string, payload push.PushPayload) (sent, failed int) {
	for len(tokens) > 0 {
		batch := tokens[:min(len(tokens), expoBatchMax)]
		tokens = tokens[len(batch):]

		ok, dead, err := expoSendBatch(ctx, batch, payload)
		if err != nil {
			log.Printf("expo-push: send batch of %d: %v", len(batch), err)
		}
		sent += ok
		failed += len(batch) - ok
		for _, tok := range dead {
			if err := s.Store.DeletePushSubscription(ctx, expoEndpointPrefix+tok); err != nil {
				log.Printf("expo-push: delete stale token: %v", err)
			}
		}
	}
	return sent, failed
}

// expoMessage is one Expo push request. `to` takes the whole batch, so a batch
// is a single message object and the response's data array lines up with it in
// order.
type expoMessage struct {
	To    []string       `json:"to"`
	Title string         `json:"title,omitempty"`
	Body  string         `json:"body,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
	Sound string         `json:"sound,omitempty"`
	// High priority is what makes Android deliver while the app is backgrounded
	// or the device dozing — the whole point of a message notification.
	Priority string `json:"priority,omitempty"`
	// Must match the channel the app creates (see mobile/src/lib/push.ts);
	// ignored on iOS.
	ChannelID string `json:"channelId,omitempty"`
}

// expoReceipt is one per-token result inside the response.
type expoReceipt struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

type expoResponse struct {
	Data   []expoReceipt `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// expoSendBatch posts one batch and reports how many were accepted plus which
// tokens the service says no longer exist. A transport/HTTP failure returns an
// error and no dead tokens: a network hiccup must never be read as "this phone
// is gone" and cost the user their registration.
func expoSendBatch(ctx context.Context, tokens []string, payload push.PushPayload) (sent int, dead []string, err error) {
	data := map[string]any{}
	if payload.Tag != "" {
		// The tap handler routes on this (mobile/src/lib/push.ts): it is the only
		// thing in the payload that says WHICH chat the notification is about.
		data["tag"] = payload.Tag
	}
	if payload.Url != "" {
		data["url"] = payload.Url
	}
	body, err := json.Marshal([]expoMessage{{
		To:        tokens,
		Title:     payload.Title,
		Body:      payload.Body,
		Data:      data,
		Sound:     "default",
		Priority:  "high",
		ChannelID: "default",
	}})
	if err != nil {
		return 0, nil, fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushURL, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := expoHTTPClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, err
	}
	if resp.StatusCode >= 400 {
		return 0, nil, fmt.Errorf("expo push rejected (%d): %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var out expoResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return 0, nil, fmt.Errorf("decode response: %w", err)
	}
	if len(out.Errors) > 0 {
		return 0, nil, fmt.Errorf("expo push error: %s", out.Errors[0].Message)
	}

	for i, rec := range out.Data {
		if rec.Status == "ok" {
			sent++
			continue
		}
		// DeviceNotRegistered is the only failure that means the token itself is
		// finished (app uninstalled, or credentials revoked). Everything else —
		// MessageTooBig, MessageRateExceeded, a provider hiccup — is about this
		// delivery, so the registration survives it.
		if rec.Details.Error == "DeviceNotRegistered" && i < len(tokens) {
			dead = append(dead, tokens[i])
			continue
		}
		log.Printf("expo-push: delivery rejected: %s (%s)", rec.Message, rec.Details.Error)
	}
	return sent, dead, nil
}
