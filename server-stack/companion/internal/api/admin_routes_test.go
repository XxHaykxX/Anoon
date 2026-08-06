package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// panelRoutes is every admin endpoint the panel actually calls (admin/src/lib/
// companion-client.ts: companionList, companionGetOne, companionUpdate*). It is
// asserted through the real mux, so a handler that exists but was never wired —
// or wired for only some methods — fails here.
//
// This list is a regression fence around a live defect: the three single-row
// GETs were missing entirely. Go's mux answers a method-less path match with the
// plain text "Method Not Allowed", the panel tried to JSON.parse that, and every
// ban / mute / unban / report-status change surfaced as an error to the operator
// AFTER companion had already applied it — because the panel re-reads the row it
// just changed. The detail pages (/users/{id}, /reports/{id}) could not open at
// all.
var panelRoutes = []struct{ method, path string }{
	{"GET", "/admin/overview"},
	{"GET", "/admin/online"},
	{"GET", "/admin/reports"},
	{"GET", "/admin/reports/1"},
	{"PATCH", "/admin/reports/1"},
	{"GET", "/admin/users"},
	{"GET", "/admin/users/1"},
	{"PATCH", "/admin/users/1"},
	{"GET", "/admin/bans"},
	{"GET", "/admin/bans/1"},
	{"PATCH", "/admin/bans/1"},
	{"GET", "/admin/media"},
	{"GET", "/admin/media/folders"},
	{"PATCH", "/admin/media/1"},
	{"POST", "/admin/broadcast"},
}

// TestAdminPanelRoutesAreWired asserts each route resolves to a handler. This
// bare Server has no AdminSecret, so adminOnly turns everything away with 503
// "admin_disabled" before any handler runs — which is exactly what makes the
// check cheap and DB-free: reaching that gate proves the route exists, while an
// unrouted method/path never gets there and answers 405 (or 404).
func TestAdminPanelRoutesAreWired(t *testing.T) {
	s := &Server{Hub: NewHub()}
	h := s.Handler()

	for _, rt := range panelRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, nil)
			req.RemoteAddr = "203.0.113.9:5000"
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			switch rec.Code {
			case http.StatusMethodNotAllowed, http.StatusNotFound:
				t.Fatalf("%s %s is not routed (got %d) — the panel calls it", rt.method, rt.path, rec.Code)
			case http.StatusServiceUnavailable, http.StatusUnauthorized, http.StatusForbidden:
				// Routed, refused at the admin gate: what we want to see here.
			default:
				// Anything else means it got PAST the gate unauthenticated, which
				// is a different and worse bug than a missing route.
				t.Fatalf("%s %s answered %d without an admin secret", rt.method, rt.path, rec.Code)
			}
		})
	}
}
