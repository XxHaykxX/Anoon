// Package oauth validates third-party sign-in tokens for the companion auth
// broker. Currently Google only; Apple/Facebook slot in behind the same
// Identity shape.
package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Identity is the verified result of a third-party sign-in.
type Identity struct {
	Provider string // "google"
	Subject  string // stable provider user id (Google "sub")
	Email    string
	Verified bool // provider asserts the email is verified
}

// defaultTokenInfoURL is Google's token verification endpoint. It validates the
// ID token's signature and expiry server-side and returns the decoded claims.
// A production build should move to local JWKS signature verification to avoid a
// network round-trip per login; this is the correct-but-simple first cut.
const defaultTokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"

// GoogleVerifier validates Google ID tokens.
type GoogleVerifier struct {
	clientID string       // expected "aud" claim (our OAuth client id)
	url      string       // tokeninfo endpoint (overridable for tests)
	client   *http.Client // overridable for tests
}

// NewGoogleVerifier builds a verifier for the given OAuth client id.
func NewGoogleVerifier(clientID string) *GoogleVerifier {
	return &GoogleVerifier{
		clientID: clientID,
		url:      defaultTokenInfoURL,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// tokenInfo is the subset of Google's tokeninfo response we consume. Numeric
// claims (aud/exp) may arrive as JSON strings, so they are typed as string.
type tokenInfo struct {
	Aud           string `json:"aud"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Exp           string `json:"exp"`
	Iss           string `json:"iss"`
	Error         string `json:"error"`
	ErrorDesc     string `json:"error_description"`
}

// Verify validates a Google ID token and returns the identity it asserts.
// It checks the signature/expiry (via Google), that the audience matches our
// client id, and that the issuer is Google.
func (v *GoogleVerifier) Verify(ctx context.Context, idToken string) (Identity, error) {
	if v.clientID == "" {
		return Identity{}, fmt.Errorf("oauth: google client id not configured")
	}
	if strings.TrimSpace(idToken) == "" {
		return Identity{}, fmt.Errorf("oauth: empty id token")
	}

	endpoint := v.url + "?id_token=" + url.QueryEscape(idToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Identity{}, err
	}

	resp, err := v.client.Do(req)
	if err != nil {
		return Identity{}, fmt.Errorf("oauth: tokeninfo request: %w", err)
	}
	defer resp.Body.Close()

	var info tokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return Identity{}, fmt.Errorf("oauth: decode tokeninfo: %w", err)
	}

	// Google returns 4xx + {error,...} for an invalid/expired token.
	if resp.StatusCode != http.StatusOK || info.Error != "" || info.Sub == "" {
		msg := info.ErrorDesc
		if msg == "" {
			msg = info.Error
		}
		if msg == "" {
			msg = "invalid token"
		}
		return Identity{}, fmt.Errorf("oauth: google rejected token: %s", msg)
	}

	if info.Aud != v.clientID {
		return Identity{}, fmt.Errorf("oauth: token audience mismatch")
	}
	if info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com" {
		return Identity{}, fmt.Errorf("oauth: unexpected issuer %q", info.Iss)
	}
	if exp, err := strconv.ParseInt(info.Exp, 10, 64); err == nil {
		if time.Now().After(time.Unix(exp, 0)) {
			return Identity{}, fmt.Errorf("oauth: token expired")
		}
	}

	return Identity{
		Provider: "google",
		Subject:  info.Sub,
		Email:    info.Email,
		Verified: info.EmailVerified == "true",
	}, nil
}
