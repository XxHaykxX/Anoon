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
	srv := httptest.NewServer(handler)
	v := NewGoogleVerifier(clientID)
	v.url = srv.URL
	v.client = srv.Client()
	return v, srv
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
