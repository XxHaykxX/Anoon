package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// ErrBadSignature is what a Provider returns when a callback fails its
// authenticity check. It is the one error the ingest path must be able to tell
// apart: everything else is "we could not understand this", while this one is
// "somebody who is not the provider sent this".
var ErrBadSignature = errors.New("billing: webhook signature does not verify")

// ErrBadCallback wraps "this came from the provider but we cannot make sense of
// it". Distinct from ErrBadSignature because the answers differ: a forged
// callback gets 403, an authentic but malformed one gets 400 and must not be
// retried, and a failure on OUR side gets 500 so that it is.
var ErrBadCallback = errors.New("billing: unusable callback")

// Event is a payment callback, reduced to the only four things a grant needs.
// Whatever the provider actually sends — JSON, form-POST, a query string —
// stops at the Provider boundary.
type Event struct {
	// OrderID is our own orders.id, echoed back by the provider.
	OrderID string
	// Ref is the provider's own payment id. It is the idempotency key stored in
	// orders.provider_ref; a provider that has none leaves it empty and
	// idempotency then rests on the order status guard alone.
	Ref string
	// AmountAMD is what the provider says was paid. It is never trusted as the
	// price — it is compared against the order's own amount, and a mismatch is
	// an incident, not a payment (PAYMENTS-PLAN §4.2 rule 4).
	AmountAMD int64
	// Paid is false for the terminal failure callbacks (cancelled, declined).
	Paid bool
}

// Provider is the seam every payment provider plugs into. No provider has been
// chosen yet (docs/PAYMENTS-PLAN.md §5-6 — Ameriabank vPOS is the recommendation,
// Idram the likely second), so this interface is deliberately the smallest set
// of operations all the candidates share:
//
//   - Ameriabank / ArCa EPG: Checkout registers the order and returns the hosted
//     payment page; there is no push callback, so ParseWebhook stays unused and a
//     status poller drives the order instead (§4.2 rule 8 — not built yet).
//   - Idram / Telcell: Checkout returns the wallet's redirect URL, ParseWebhook
//     verifies an MD5 checksum over form fields, Ack must write exactly "OK".
//
// Nothing here takes a secret: keys live in the concrete provider, built from
// the environment (see FromEnv).
type Provider interface {
	// Name is the provider's stable code — it lands in orders.provider and in
	// the webhook route, so it must not change once orders exist.
	Name() string
	// Checkout returns the URL the payer's browser is sent to for order o.
	Checkout(o Order) (string, error)
	// ParseWebhook verifies authenticity and decodes the callback. It returns
	// ErrBadSignature when the request did not come from the provider.
	ParseWebhook(h http.Header, body []byte) (Event, error)
	// Ack writes the exact response body the provider expects. granted reports
	// whether the event actually moved money on our side; some providers use a
	// two-phase precheck where the answer differs.
	Ack(w http.ResponseWriter, granted bool)
}

// --- fake provider ---------------------------------------------------------

// fakeProvider is the sandbox implementation: it lets the entire flow —
// order, hosted page, callback, grant, balance — run locally with no third
// party and no real keys. Its callback is a JSON body signed with HMAC-SHA256
// over the raw bytes, which is the strictest of the shapes the real candidates
// use (Idram/Telcell sign a field concatenation with MD5), so a handler that is
// correct here does not get looser when a real provider lands.
//
// It is refused outright when ENV=prod (see FromEnv): a provider whose signing
// key is in our own .env can mint payments.
type fakeProvider struct {
	secret  []byte
	baseURL string // where the sandbox checkout page lives, e.g. "http://127.0.0.1:6062"
}

// fakeSignatureHeader carries the hex HMAC-SHA256 of the raw request body.
const fakeSignatureHeader = "X-Anoon-Signature"

func (p *fakeProvider) Name() string { return "fake" }

// Checkout points at the sandbox page served by this very service (see
// http.go). A real provider returns its own hosted page instead — the payer
// must never type card data into anything we serve.
func (p *fakeProvider) Checkout(o Order) (string, error) {
	return fmt.Sprintf("%s/billing/fake/checkout?order=%s", strings.TrimRight(p.baseURL, "/"), url.QueryEscape(o.ID)), nil
}

// fakeCallback is the JSON body the sandbox posts back.
type fakeCallback struct {
	OrderID   string `json:"orderId"`
	Ref       string `json:"ref"`
	AmountAMD int64  `json:"amountAmd"`
	Status    string `json:"status"` // "paid" | "failed"
}

func (p *fakeProvider) ParseWebhook(h http.Header, body []byte) (Event, error) {
	// Signature first, before the body is given any meaning at all
	// (PAYMENTS-PLAN §4.2 rule 2).
	if !p.verify(h.Get(fakeSignatureHeader), body) {
		return Event{}, ErrBadSignature
	}
	var cb fakeCallback
	if err := json.Unmarshal(body, &cb); err != nil {
		return Event{}, fmt.Errorf("billing: fake callback body: %w", err)
	}
	if cb.OrderID == "" {
		return Event{}, errors.New("billing: fake callback has no orderId")
	}
	return Event{
		OrderID:   cb.OrderID,
		Ref:       cb.Ref,
		AmountAMD: cb.AmountAMD,
		Paid:      cb.Status == "paid",
	}, nil
}

// verify compares hex(HMAC-SHA256(body)) against the header in constant time.
func (p *fakeProvider) verify(got string, body []byte) bool {
	want := p.sign(body)
	// hmac.Equal over the decoded bytes would reject a valid-but-differently-
	// cased hex; comparing the hex strings avoids that and leaks nothing beyond
	// the length, which is fixed.
	return hmac.Equal([]byte(strings.ToLower(strings.TrimSpace(got))), []byte(want))
}

func (p *fakeProvider) sign(body []byte) string {
	mac := hmac.New(sha256.New, p.secret)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// Ack answers "OK" whatever happened, as Idram and Telcell both require: the
// callback is acknowledged as *received*, and a provider that reads anything
// else retries forever over an event we have already durably recorded.
func (p *fakeProvider) Ack(w http.ResponseWriter, _ bool) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK"))
}
