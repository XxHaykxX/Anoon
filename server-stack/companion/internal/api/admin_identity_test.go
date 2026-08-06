package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testAdminKey = []byte("test-admin-session-secret-at-least-16")

// signOperatorToken mints a token shaped exactly like the one the admin service
// already issues for its session cookie (admin/src/lib/admin-session.ts):
// HS256, subject = operator id, a "role" claim, and an expiry.
func signOperatorToken(t *testing.T, key []byte, sub, role string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  sub,
		"role": role,
		"iat":  time.Now().Unix(),
		"exp":  exp.Unix(),
	})
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func adminReq(headers map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodPatch, "/admin/users/1", nil)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

// --- attested mode (COMPANION_ADMIN_TOKEN_SECRET configured) -----------------

func TestAdminIdentityAttestedUsesToken(t *testing.T) {
	token := signOperatorToken(t, testAdminKey, "op-42", roleSuperAdmin, time.Now().Add(time.Hour))
	id, role, err := adminIdentity(adminReq(map[string]string{adminTokenHeader: token}), testAdminKey)
	if err != nil {
		t.Fatalf("valid operator token rejected: %v", err)
	}
	if id != "op-42" {
		t.Fatalf("operator id = %q, want op-42 (the verified token subject)", id)
	}
	if role != roleSuperAdmin {
		t.Fatalf("role = %q, want %q", role, roleSuperAdmin)
	}
}

// The point of the whole change: with a token secret configured, the headers
// that used to carry identity are inert. A moderator cannot promote themselves
// to super_admin, nor pin the moderation-log authorship on someone else.
func TestAdminIdentityAttestedIgnoresForgedHeaders(t *testing.T) {
	token := signOperatorToken(t, testAdminKey, "op-mod", roleModerator, time.Now().Add(time.Hour))
	id, role, err := adminIdentity(adminReq(map[string]string{
		adminTokenHeader: token,
		"X-Admin-Id":     "op-someone-else",
		"X-Admin-Role":   roleSuperAdmin,
	}), testAdminKey)
	if err != nil {
		t.Fatalf("valid operator token rejected: %v", err)
	}
	if role != roleModerator {
		t.Fatalf("X-Admin-Role escalated the operator to %q — the header must be ignored", role)
	}
	if id != "op-mod" {
		t.Fatalf("X-Admin-Id rewrote authorship to %q — the header must be ignored", id)
	}
}

// In attested mode a missing token fails the request; it must never silently
// fall back to the forgeable headers.
func TestAdminIdentityAttestedRejectsBadTokens(t *testing.T) {
	otherKey := []byte("a-completely-different-signing-key!!")
	tests := []struct {
		name  string
		token string
	}{
		{"absent", ""},
		{"blank", "   "},
		{"not a jwt", "hunter2"},
		{"wrong signing key", signOperatorToken(t, otherKey, "op-42", roleSuperAdmin, time.Now().Add(time.Hour))},
		{"expired", signOperatorToken(t, testAdminKey, "op-42", roleSuperAdmin, time.Now().Add(-time.Minute))},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			headers := map[string]string{"X-Admin-Id": "op-forged", "X-Admin-Role": roleSuperAdmin}
			if tc.token != "" {
				headers[adminTokenHeader] = tc.token
			}
			if _, _, err := adminIdentity(adminReq(headers), testAdminKey); err == nil {
				t.Fatal("bad operator token accepted — attested mode must not fall back to headers")
			}
		})
	}
}

// A token with no expiry would be replayable forever, and an unsigned ("alg:
// none") one would be trivially mintable. Both must be refused.
func TestVerifyAdminTokenRejectsUnsafeShapes(t *testing.T) {
	noExpiry := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "op-42", "role": roleSuperAdmin})
	signed, err := noExpiry.SignedString(testAdminKey)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	if _, _, err := verifyAdminToken(signed, testAdminKey); err == nil {
		t.Fatal("token without an expiry accepted")
	}

	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub": "op-42", "role": roleSuperAdmin, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	if _, _, err := verifyAdminToken(unsigned, testAdminKey); err == nil {
		t.Fatal("unsigned (alg=none) token accepted")
	}

	noSubject := signOperatorToken(t, testAdminKey, "", roleSuperAdmin, time.Now().Add(time.Hour))
	if _, _, err := verifyAdminToken(noSubject, testAdminKey); err == nil {
		t.Fatal("token without a subject accepted — there would be no authorship to record")
	}
}

// --- legacy mode (no token secret — how the admin UI talks today) ------------

func TestAdminIdentityLegacyUsesHeaders(t *testing.T) {
	id, role, err := adminIdentity(adminReq(map[string]string{
		"X-Admin-Id":   "op-7",
		"X-Admin-Role": roleSuperAdmin,
	}), nil)
	if err != nil {
		t.Fatalf("legacy header identity rejected: %v", err)
	}
	if id != "op-7" || role != roleSuperAdmin {
		t.Fatalf("legacy identity = (%q, %q), want (op-7, %q)", id, role, roleSuperAdmin)
	}
}

// An unknown or absent role must land on the least-privileged value rather than
// on something requireSuperAdmin might wave through.
func TestNormalizeRole(t *testing.T) {
	tests := []struct{ in, want string }{
		{roleSuperAdmin, roleSuperAdmin},
		{" " + roleSuperAdmin + " ", roleSuperAdmin},
		{roleModerator, roleModerator},
		{"", roleModerator},
		{"root", roleModerator},
		{"SUPER_ADMIN", roleModerator},
		{"super_admin ", roleSuperAdmin},
	}
	for _, tc := range tests {
		if got := normalizeRole(tc.in); got != tc.want {
			t.Fatalf("normalizeRole(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
