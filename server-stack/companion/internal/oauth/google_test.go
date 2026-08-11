package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"time"
)
import "testing"

// newTestVerifier points a verifier at a stub tokeninfo server.
func newTestVerifier(clientID string, handler http.HandlerFunc) (*GoogleVerifier, *httptest.Server) {
	return newTestVerifierMulti(handler, clientID)
}

// newTestVerifierMulti is newTestVerifier for the multi-audience case.
func newTestVerifierMulti(handler http.HandlerFunc, clientIDs ...string) (*GoogleVerifier, *httptest.Server) {
	srv := httptest.NewServer(handler)
	v := NewGoogleVerifier(clientIDs...)
	v.url = srv.URL
	v.client = srv.Client()
	return v, srv
}

// The phone cannot present the web client id — Google refuses a custom-scheme
// redirect for a "Web" client, so Android and iOS each sign with their own, and
// the verifier has to accept all three. Before this, a token minted by the app
// died as "audience mismatch".
func TestGoogleVerify_AcceptsAnyConfiguredAudience(t *testing.T) {
	exp := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	for _, aud := range []string{"anoon-web", "anoon-android", "anoon-ios"} {
		v, srv := newTestVerifierMulti(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"aud":"` + aud + `","sub":"123","email":"a@b.co","email_verified":"true","exp":"` + exp + `","iss":"accounts.google.com"}`))
		}, "anoon-web", "anoon-android", "anoon-ios")

		if _, err := v.Verify(context.Background(), "tok"); err != nil {
			t.Errorf("aud %q: %v", aud, err)
		}
		srv.Close()
	}
}

// A blank entry (COMPANION_GOOGLE_CLIENT_IDS="web,,ios") must not become an
// accepted audience — a token with no aud would otherwise walk straight in.
func TestGoogleVerify_BlankAudienceNeverMatches(t *testing.T) {
	exp := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	v, srv := newTestVerifierMulti(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"aud":"","sub":"123","exp":"` + exp + `","iss":"accounts.google.com"}`))
	}, "anoon-web", "  ", "")
	defer srv.Close()

	if _, err := v.Verify(context.Background(), "tok"); err == nil {
		t.Fatal("empty aud was accepted")
	}
}

func TestGoogleVerify_OK(t *testing.T) {
	exp := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	v, srv := newTestVerifier("anoon-client", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id_token") == "" {
			t.Error("id_token not forwarded")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"aud":"anoon-client","sub":"123","email":"a@b.co","email_verified":"true","exp":"` + exp + `","iss":"accounts.google.com"}`))
	})
	defer srv.Close()

	id, err := v.Verify(context.Background(), "tok")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if id.Subject != "123" || id.Email != "a@b.co" || !id.Verified || id.Provider != "google" {
		t.Fatalf("unexpected identity: %+v", id)
	}
}

func TestGoogleVerify_AudienceMismatch(t *testing.T) {
	exp := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	v, srv := newTestVerifier("anoon-client", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"aud":"someone-else","sub":"123","exp":"` + exp + `","iss":"accounts.google.com"}`))
	})
	defer srv.Close()

	if _, err := v.Verify(context.Background(), "tok"); err == nil {
		t.Fatal("expected audience mismatch error")
	}
}

func TestGoogleVerify_RejectedToken(t *testing.T) {
	v, srv := newTestVerifier("anoon-client", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"invalid_token","error_description":"Invalid Value"}`))
	})
	defer srv.Close()

	if _, err := v.Verify(context.Background(), "bad"); err == nil {
		t.Fatal("expected rejection error")
	}
}

func TestGoogleVerify_Expired(t *testing.T) {
	past := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10)
	v, srv := newTestVerifier("anoon-client", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"aud":"anoon-client","sub":"123","exp":"` + past + `","iss":"accounts.google.com"}`))
	})
	defer srv.Close()

	if _, err := v.Verify(context.Background(), "tok"); err == nil {
		t.Fatal("expected expiry error")
	}
}
