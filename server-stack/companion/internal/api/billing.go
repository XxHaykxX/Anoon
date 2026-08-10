package api

import (
	"log"
	"net/http"

	"anoon/companion/internal/billing"
)

// registerBilling mounts the payments module (#14) if it is configured.
//
// Billing is OFF unless BILLING_PROVIDER names a provider, which is the shipped
// default: no provider has been chosen (docs/PAYMENTS-PLAN.md §5-6), so the
// routes simply do not exist rather than answering with a placeholder. See
// internal/billing for the env contract.
//
// Configuration lives in the billing package rather than internal/config on
// purpose: every key here belongs to whichever provider is eventually signed,
// and a provider swap should not have to touch the shared Config struct.
//
// A configuration error is fatal-by-log, not fatal-by-exit: this runs from
// Handler(), which cannot fail, and a companion that refuses to serve chat
// because a payment key is malformed is a worse outage than one that serves
// everything but payments. The line is loud enough to find.
func (s *Server) registerBilling(mux *http.ServeMux) {
	svc, err := billing.FromEnv(s.DB, s.billingUser)
	if err != nil {
		log.Printf("billing: DISABLED — %v", err)
		return
	}
	if svc == nil {
		return // BILLING_PROVIDER unset: nothing to mount, nothing to say.
	}
	svc.Register(mux)
}

// billingUser is the auth seam the billing package calls: it owns money, not
// sessions, so it never sees a token. Same authentication as every other
// authenticated route, presence heartbeat included.
func (s *Server) billingUser(r *http.Request) (int64, bool) {
	u, err := s.authUser(r.Context(), r)
	if err != nil {
		return 0, false
	}
	s.touchPresence(u.ID)
	return u.ID, true
}
