package api

import "testing"

func TestNewRecoveryToken(t *testing.T) {
	a := newRecoveryToken()
	b := newRecoveryToken()
	// 32 random bytes -> 64 hex chars.
	if len(a) != 64 {
		t.Fatalf("token length = %d, want 64 hex chars", len(a))
	}
	if a == b {
		t.Fatal("two generated tokens must not collide")
	}
	for _, c := range a {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Fatalf("token has non-hex char %q", c)
		}
	}
}
