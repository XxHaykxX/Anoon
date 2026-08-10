package billing

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"
)

func testFake() *fakeProvider {
	return &fakeProvider{secret: []byte("sandbox-secret"), baseURL: "http://127.0.0.1:6062/"}
}

// A callback whose signature does not verify must be refused BEFORE its body is
// given any meaning — otherwise the amount and the order id in a forged body
// are as good as a real payment.
func TestParseWebhookRejectsForgedSignature(t *testing.T) {
	p := testFake()
	body := []byte(`{"orderId":"11111111-1111-4111-8111-111111111111","amountAmd":490,"status":"paid"}`)

	cases := map[string]string{
		"no signature":    "",
		"wrong signature": strings.Repeat("ab", 32),
		"truncated":       p.sign(body)[:16],
		"other key":       (&fakeProvider{secret: []byte("not-the-key")}).sign(body),
	}
	for name, sig := range cases {
		t.Run(name, func(t *testing.T) {
			h := http.Header{}
			if sig != "" {
				h.Set(fakeSignatureHeader, sig)
			}
			if _, err := p.ParseWebhook(h, body); !errors.Is(err, ErrBadSignature) {
				t.Fatalf("ParseWebhook with %s = %v, want ErrBadSignature", name, err)
			}
		})
	}
}

// The signature covers the RAW bytes, so flipping any field invalidates it —
// including the amount, which is the field worth forging.
func TestParseWebhookSignatureCoversTheWholeBody(t *testing.T) {
	p := testFake()
	body := []byte(`{"orderId":"11111111-1111-4111-8111-111111111111","ref":"r1","amountAmd":490,"status":"paid"}`)
	h := http.Header{}
	h.Set(fakeSignatureHeader, p.sign(body))

	ev, err := p.ParseWebhook(h, body)
	if err != nil {
		t.Fatalf("ParseWebhook on a correctly signed body: %v", err)
	}
	if ev.OrderID != "11111111-1111-4111-8111-111111111111" || ev.AmountAMD != 490 || ev.Ref != "r1" || !ev.Paid {
		t.Fatalf("decoded event = %+v, want the body's own values", ev)
	}

	tampered := []byte(strings.Replace(string(body), `"amountAmd":490`, `"amountAmd":49000`, 1))
	if _, err := p.ParseWebhook(h, tampered); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("ParseWebhook on a tampered amount = %v, want ErrBadSignature", err)
	}
}

// A callback that verifies but carries no order id is unusable, and must be
// told apart from a forged one (400 vs 403, retry vs never retry).
func TestParseWebhookRejectsBodyWithoutOrder(t *testing.T) {
	p := testFake()
	body := []byte(`{"amountAmd":490,"status":"paid"}`)
	h := http.Header{}
	h.Set(fakeSignatureHeader, p.sign(body))

	_, err := p.ParseWebhook(h, body)
	if err == nil || errors.Is(err, ErrBadSignature) {
		t.Fatalf("ParseWebhook without orderId = %v, want a plain parse error", err)
	}
}

// The sandbox provider signs with a key that lives in our own .env — in
// production that is a licence to mint coins, so the wiring must refuse it
// rather than come up quietly.
func TestFromEnvRefusesSandboxInProd(t *testing.T) {
	t.Setenv("BILLING_PROVIDER", "fake")
	t.Setenv("BILLING_FAKE_SECRET", "whatever")
	t.Setenv("ENV", "prod")

	if _, err := FromEnv(nil, nil); err == nil {
		t.Fatal("FromEnv accepted the sandbox provider with ENV=prod")
	}

	// And with ENV unset at all — config.Load defaults to prod, so this must too.
	os.Unsetenv("ENV")
	if _, err := FromEnv(nil, nil); err == nil {
		t.Fatal("FromEnv accepted the sandbox provider with ENV unset (defaults to prod)")
	}
}

// Unset BILLING_PROVIDER is the shipped default, not an error: no provider has
// been chosen yet, and billing must simply not mount.
func TestFromEnvDisabledByDefault(t *testing.T) {
	t.Setenv("BILLING_PROVIDER", "")
	svc, err := FromEnv(nil, nil)
	if err != nil || svc != nil {
		t.Fatalf("FromEnv with no provider = (%v, %v), want (nil, nil)", svc, err)
	}
}

func TestLooksLikeUUID(t *testing.T) {
	ok := []string{"11111111-1111-4111-8111-111111111111", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"}
	bad := []string{"", "1", "'; DROP TABLE orders; --", "11111111-1111-4111-8111-11111111111", "11111111111141118111111111111111111z"}
	for _, s := range ok {
		if !looksLikeUUID(s) {
			t.Errorf("looksLikeUUID(%q) = false, want true", s)
		}
	}
	for _, s := range bad {
		if looksLikeUUID(s) {
			t.Errorf("looksLikeUUID(%q) = true, want false", s)
		}
	}
}
