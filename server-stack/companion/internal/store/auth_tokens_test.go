package store

import (
	"context"
	"database/sql/driver"
	"reflect"
	"strings"
	"testing"
)

// TestSetEmailVerifiedIsAddressScoped pins what a verification token actually
// authorises: one ADDRESS, not "whatever this account holds at redemption
// time". Without the address in the WHERE, someone could request a link for
// their own inbox, point the account at a victim's, then redeem — and come out
// verified for an address they never controlled.
func TestSetEmailVerifiedIsAddressScoped(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.affected = 1 // the address still matches

	ok, err := st.SetEmailVerified(context.Background(), 7, "person@example.com")
	if err != nil {
		t.Fatalf("SetEmailVerified: %v", err)
	}
	if !ok {
		t.Error("a matching address should verify")
	}

	stmt := rec.only(t)
	if !strings.Contains(stmt.query, "u.id = $1") {
		t.Errorf("update is not scoped to the token's user — query was:\n%s", stmt.query)
	}
	if !strings.Contains(stmt.query, "lower($2)") {
		t.Errorf("update does not compare the token's address — query was:\n%s", stmt.query)
	}
	// The token's address may have come from a linked Google identity rather
	// than users.email (EmailForUser falls back to it), so the comparison has to
	// resolve the same way or Google-only accounts could never verify.
	if !strings.Contains(stmt.query, "oauth_identities") {
		t.Errorf("comparison does not mirror EmailForUser's fallback — query was:\n%s", stmt.query)
	}
	want := []driver.Value{int64(7), "person@example.com"}
	if !reflect.DeepEqual(stmt.args, want) {
		t.Errorf("args = %+v, want %+v", stmt.args, want)
	}
}

// TestSetEmailVerifiedRejectsAChangedAddress is the failure path: the address
// moved between issue and redemption, nothing matched, and the caller must be
// told rather than left believing the address was confirmed.
func TestSetEmailVerifiedRejectsAChangedAddress(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.affected = 0 // no row matched: users.email is no longer the token's

	ok, err := st.SetEmailVerified(context.Background(), 7, "old@example.com")
	if err != nil {
		t.Fatalf("SetEmailVerified: %v", err)
	}
	if ok {
		t.Error("an address that no longer matches must not verify")
	}
}

// TestSetEmailVerifiedWithoutAnAddress guards the degenerate input: a token
// stored with no address proves nothing, so it must verify nothing — and must
// not issue an UPDATE whose address comparison would be against "".
func TestSetEmailVerifiedWithoutAnAddress(t *testing.T) {
	st, rec := newRecordingStore(t)

	ok, err := st.SetEmailVerified(context.Background(), 7, "")
	if err != nil {
		t.Fatalf("SetEmailVerified: %v", err)
	}
	if ok {
		t.Error("an empty address must not verify")
	}
	if n := rec.count(); n != 0 {
		t.Errorf("empty address issued %d statements, want none", n)
	}
}

// TestConsumeAuthTokenReturnsTheIssuedAddress pins the other half of the chain:
// redemption hands back the address the token was mailed to, which is what
// SetEmailVerified checks against. Returning only the user id is what made the
// address check impossible to write.
func TestConsumeAuthTokenReturnsTheIssuedAddress(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"user_id", "email"}
	rec.rows = [][]driver.Value{{int64(7), "person@example.com"}}

	userID, email, err := st.ConsumeAuthToken(context.Background(), "verify", "tok")
	if err != nil {
		t.Fatalf("ConsumeAuthToken: %v", err)
	}
	if userID != 7 || email != "person@example.com" {
		t.Errorf("got (%d, %q), want (7, \"person@example.com\")", userID, email)
	}
	if stmt := rec.only(t); !strings.Contains(stmt.query, "RETURNING user_id, email") {
		t.Errorf("redemption does not return the issued address — query was:\n%s", stmt.query)
	}
}
