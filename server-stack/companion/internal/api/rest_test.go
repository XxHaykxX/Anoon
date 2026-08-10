package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"anoon/companion/internal/oauth"
)

// okHandler records that the wrapped handler ran and answers 200.
func okHandler(reached *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusOK)
	}
}

func TestRestOnlySecretGate(t *testing.T) {
	const secret = "s3cr3t-rest-token"

	tests := []struct {
		name       string
		configured string
		setAuth    func(*http.Request)
		wantStatus int
		wantReach  bool
	}{
		{
			name:       "no secret configured disables the hook",
			configured: "",
			setAuth:    func(*http.Request) {},
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			// The H1 exploit: an anonymous POST with no credential at all.
			name:       "missing credential is rejected",
			configured: secret,
			setAuth:    func(*http.Request) {},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong header secret is rejected",
			configured: secret,
			setAuth:    func(r *http.Request) { r.Header.Set(restSecretHeader, "not-the-secret") },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong basic-auth secret is rejected",
			configured: secret,
			setAuth:    func(r *http.Request) { r.SetBasicAuth("tinode", "not-the-secret") },
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "correct header secret passes",
			configured: secret,
			setAuth:    func(r *http.Request) { r.Header.Set(restSecretHeader, secret) },
			wantStatus: http.StatusOK,
			wantReach:  true,
		},
		{
			// How Tinode delivers it: userinfo baked into server_url, which
			// net/http turns into an Authorization: Basic header.
			name:       "correct basic-auth secret passes",
			configured: secret,
			setAuth:    func(r *http.Request) { r.SetBasicAuth("tinode", secret) },
			wantStatus: http.StatusOK,
			wantReach:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			reached := false
			s := &Server{RestSecret: tc.configured}
			r := httptest.NewRequest(http.MethodPost, "/auth/rest", strings.NewReader(`{"endpoint":"rtagns"}`))
			tc.setAuth(r)
			w := httptest.NewRecorder()

			s.restOnly(okHandler(&reached))(w, r)

			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body %q)", w.Code, tc.wantStatus, w.Body.String())
			}
			if reached != tc.wantReach {
				t.Fatalf("handler reached = %v, want %v", reached, tc.wantReach)
			}
		})
	}
}

// The header wins when both positions are present, so a caller that can set
// headers is never silently downgraded to whatever userinfo a URL carries.
func TestPresentedRestSecretPrefersHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/auth/rest", nil)
	r.SetBasicAuth("tinode", "from-basic")
	r.Header.Set(restSecretHeader, "from-header")
	if got := presentedRestSecret(r); got != "from-header" {
		t.Fatalf("presentedRestSecret = %q, want %q", got, "from-header")
	}
}

// The Google claims are best-effort: `name` may be absent while given/family
// are present, and a profile with neither must not put an empty `public` on the
// new account (which would then look "filled" and never be seeded again).
func TestGoogleAccountPublic(t *testing.T) {
	tests := []struct {
		name    string
		id      oauth.Identity
		wantFn  any
		wantPic any
	}{
		{"full name wins", oauth.Identity{Name: "Айк Карапетян", GivenName: "Айк", Picture: "https://lh3/x"}, "Айк Карапетян", "https://lh3/x"},
		{"given+family when name absent", oauth.Identity{GivenName: "Айк", FamilyName: "Карапетян"}, "Айк Карапетян", nil},
		{"given only", oauth.Identity{GivenName: "Айк"}, "Айк", nil},
		{"photo only", oauth.Identity{Picture: "https://lh3/y"}, nil, "https://lh3/y"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pub, _ := googleAccountPublic(tc.id).(map[string]any)
			if got := pub["fn"]; got != tc.wantFn {
				t.Errorf("fn = %v, want %v", got, tc.wantFn)
			}
			var gotPic any
			if photo, ok := pub["photo"].(map[string]any); ok {
				gotPic = photo["ref"]
			}
			if gotPic != tc.wantPic {
				t.Errorf("photo.ref = %v, want %v", gotPic, tc.wantPic)
			}
		})
	}
	if got := googleAccountPublic(oauth.Identity{Subject: "123", Email: "a@b.c"}); got != nil {
		t.Errorf("no profile claims: public = %v, want nil", got)
	}
}
