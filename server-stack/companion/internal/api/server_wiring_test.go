package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The admin surface must keep working in LEGACY mode — the shipped default,
// where COMPANION_ADMIN_TOKEN_SECRET is unset and config.Load therefore leaves
// Server.AdminTokenSecret empty. This is the wiring seam between config and the
// middleware: adminIdentity's own behavior is covered in admin_identity_test.go,
// but nothing else pins the consequence of an empty field arriving here.
//
// Getting this wrong is not a degraded mode, it is an outage: a non-empty
// AdminTokenSecret selects attested mode, where header identity is ignored
// entirely, so every admin request 401s and the whole panel goes dark at once.
func TestAdminOnlyLegacyModeAcceptsHeaderIdentity(t *testing.T) {
	const secret = "admin-shared-secret"

	// Exactly what NewServer produces when config.Load saw no
	// COMPANION_ADMIN_TOKEN_SECRET: []byte("") — empty, but not nil.
	s := &Server{AdminSecret: secret, AdminTokenSecret: []byte("")}

	var gotID, gotRole string
	handler := s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		gotID, gotRole = adminID(r.Context()), adminRole(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	r := httptest.NewRequest(http.MethodGet, "/admin/overview", nil)
	r.Header.Set("X-Companion-Admin-Secret", secret)
	r.Header.Set("X-Admin-Id", "operator-7")
	r.Header.Set("X-Admin-Role", roleSuperAdmin)
	// Deliberately NO X-Admin-Token: the admin UI already sends one, and legacy
	// mode must ignore it rather than start requiring it.
	w := httptest.NewRecorder()

	handler(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("legacy-mode admin request = %d, want 200 (body %q)", w.Code, w.Body.String())
	}
	if gotID != "operator-7" {
		t.Fatalf("adminID = %q, want operator-7", gotID)
	}
	if gotRole != roleSuperAdmin {
		t.Fatalf("adminRole = %q, want %q", gotRole, roleSuperAdmin)
	}
}

// A nil AdminTokenSecret must behave identically to an empty one — len() is the
// legacy test, so the two are equivalent, and no future wiring change should be
// able to make nil mean something different.
func TestAdminOnlyNilTokenSecretIsAlsoLegacy(t *testing.T) {
	const secret = "admin-shared-secret"
	s := &Server{AdminSecret: secret, AdminTokenSecret: nil}

	reached := false
	handler := s.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})

	r := httptest.NewRequest(http.MethodGet, "/admin/overview", nil)
	r.Header.Set("X-Companion-Admin-Secret", secret)
	r.Header.Set("X-Admin-Id", "operator-7")
	w := httptest.NewRecorder()

	handler(w, r)

	if w.Code != http.StatusOK || !reached {
		t.Fatalf("nil token secret should behave as legacy mode, got %d reached=%v", w.Code, reached)
	}
}
