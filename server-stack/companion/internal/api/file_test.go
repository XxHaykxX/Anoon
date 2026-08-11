package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The file proxy fetches as ROOT, so an open route would hand any caller any
// attachment on the server. It must be refused at the admin gate — before the
// handler, which here has a nil Tinode client and would panic rather than serve.
func TestAdminFileRequiresAdminGate(t *testing.T) {
	h := (&Server{Hub: NewHub()}).Handler()

	req := httptest.NewRequest(http.MethodGet, "/admin/file?ref=/v0/file/s/abc.jpg", nil)
	req.RemoteAddr = "203.0.113.9:5000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	switch rec.Code {
	case http.StatusMethodNotAllowed, http.StatusNotFound:
		t.Fatalf("GET /admin/file is not routed (got %d) — the panel calls it", rec.Code)
	case http.StatusServiceUnavailable, http.StatusUnauthorized, http.StatusForbidden:
		// Refused at the gate: what we want.
	default:
		t.Fatalf("GET /admin/file answered %d without an admin secret", rec.Code)
	}
}
