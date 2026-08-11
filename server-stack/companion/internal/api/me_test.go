package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// PATCH /me has to tell three cases apart, and a pointer field can only tell
// two: encoding/json writes a JSON null as the zero value, so `{"age":null}`
// and a body with no "age" at all both arrive as nil. Saving any other profile
// field would then either wipe everyone's age or make it impossible to clear.
func TestParseAgeEdit(t *testing.T) {
	for _, tc := range []struct {
		name        string
		body        string
		wantPresent bool
		wantAge     *int // nil with wantPresent = "clear it"
		wantErr     bool
	}{
		{name: "absent", body: `{}`},
		{name: "absent among other fields", body: `{"nickname":"x"}`},
		{name: "explicit null clears", body: `{"age":null}`, wantPresent: true},
		{name: "a value", body: `{"age":30}`, wantPresent: true, wantAge: intp(30)},
		{name: "lower bound", body: `{"age":13}`, wantPresent: true, wantAge: intp(13)},
		{name: "upper bound", body: `{"age":120}`, wantPresent: true, wantAge: intp(120)},
		{name: "below range", body: `{"age":12}`, wantPresent: true, wantErr: true},
		{name: "above range", body: `{"age":121}`, wantPresent: true, wantErr: true},
		{name: "not a number", body: `{"age":"thirty"}`, wantPresent: true, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var req patchMeRequest
			if err := json.Unmarshal([]byte(tc.body), &req); err != nil {
				t.Fatalf("decode %s: %v", tc.body, err)
			}
			age, present, err := parseAgeEdit(req.Age)

			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, want error: %v", err, tc.wantErr)
			}
			if present != tc.wantPresent {
				t.Fatalf("present = %v, want %v", present, tc.wantPresent)
			}
			if tc.wantErr {
				return
			}
			switch {
			case tc.wantAge == nil && age != nil:
				t.Fatalf("age = %d, want it left alone/cleared", *age)
			case tc.wantAge != nil && age == nil:
				t.Fatalf("age = nil, want %d", *tc.wantAge)
			case tc.wantAge != nil && *age != *tc.wantAge:
				t.Fatalf("age = %d, want %d", *age, *tc.wantAge)
			}
		})
	}
}

func intp(n int) *int { return &n }

// The profile screen's age field wrote to browser memory alone because this
// route did not exist. Nil Store makes the check load-bearing: reaching the
// handler body would panic, so anything other than a routed-and-refused answer
// is a real failure.
func TestPatchMeIsRouted(t *testing.T) {
	h := (&Server{Hub: NewHub()}).Handler()

	req := httptest.NewRequest(http.MethodPatch, "/me", strings.NewReader(`{"age":30}`))
	req.RemoteAddr = "203.0.113.9:5000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	switch rec.Code {
	case http.StatusMethodNotAllowed, http.StatusNotFound:
		t.Fatalf("PATCH /me is not routed (got %d) — the profile screen calls it", rec.Code)
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusServiceUnavailable:
		// Routed, then refused for want of a session: what we want.
	default:
		t.Fatalf("PATCH /me answered %d without a session token", rec.Code)
	}
}
