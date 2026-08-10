package billing

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
)

// Register mounts the billing routes on mux. A nil *Service mounts nothing —
// that is the shipped default until a provider is chosen, and it is why the
// endpoints simply do not exist rather than returning a "coming soon" body.
//
// Route summary (the contract the wallet screen will be wired to):
//
//	GET  /billing/products        → {"products":[{code,kind,tier,periodDays,coins,priceAmd}]}
//	POST /billing/orders          → {productCode} ⇒ {id,status,amountAmd,payUrl,expiresAt}
//	GET  /billing/orders/{id}     → {id,productCode,amountAmd,status,createdAt,expiresAt}
//	POST /billing/webhook/{name}  → provider only; signature-checked, idempotent
//
// Plus, when the sandbox provider is configured, a stand-in for the provider's
// hosted page: GET /billing/fake/checkout and POST /billing/fake/pay.
func (s *Service) Register(mux *http.ServeMux) {
	if s == nil {
		return
	}
	mux.HandleFunc("GET /billing/products", s.handleProducts)
	mux.HandleFunc("POST /billing/orders", s.handleCreateOrder)
	mux.HandleFunc("GET /billing/orders/{id}", s.handleOrderStatus)
	mux.HandleFunc("POST /billing/webhook/{provider}", s.handleWebhook)

	if fake, ok := s.provider.(*fakeProvider); ok {
		mux.HandleFunc("GET /billing/fake/checkout", s.handleFakeCheckout)
		mux.HandleFunc("POST /billing/fake/pay", s.fakePayHandler(fake))
		log.Printf("billing: SANDBOX provider active — /billing/fake/* can settle orders without money")
	}
	log.Printf("billing: enabled, provider=%s", s.provider.Name())
}

// --- client routes ---------------------------------------------------------

func (s *Service) handleProducts(w http.ResponseWriter, r *http.Request) {
	// Public on purpose: a price list is what the wallet screen needs before
	// anybody has signed in, and it is the same list the bank requires to be
	// visible on the site (PAYMENTS-PLAN §3.4, Ameriabank T&C 4.10).
	products, err := s.Products(r.Context())
	if err != nil {
		log.Printf("billing: products: %v", err)
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the catalogue")
		return
	}
	if products == nil {
		products = []Product{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"products": products})
}

func (s *Service) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req struct {
		ProductCode string `json:"productCode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	// Note what is NOT in that body: an amount. The client picks a product; the
	// price is the catalogue's (PAYMENTS-PLAN §4.2 rule 4).
	order, err := s.CreateOrder(r.Context(), userID, req.ProductCode)
	if errors.Is(err, ErrNoProduct) {
		writeError(w, http.StatusBadRequest, "no_such_product", "unknown or inactive product")
		return
	}
	if err != nil {
		log.Printf("billing: create order for user %d (%s): %v", userID, req.ProductCode, err)
		writeError(w, http.StatusBadGateway, "provider_failed", "could not start the payment")
		return
	}
	writeJSON(w, http.StatusCreated, order)
}

func (s *Service) handleOrderStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	// This is what the frontend polls after the payer comes back from the
	// provider. The return URL itself grants nothing — it is a redirect anyone
	// can type (§4.2 rule 5) — so this endpoint is the only thing the wallet
	// screen may believe.
	order, err := s.OrderOf(r.Context(), userID, r.PathValue("id"))
	if errors.Is(err, ErrNoOrder) {
		writeError(w, http.StatusNotFound, "no_such_order", "order not found")
		return
	}
	if err != nil {
		log.Printf("billing: order status: %v", err)
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the order")
		return
	}
	writeJSON(w, http.StatusOK, order)
}

// requireUser resolves the caller, or writes a 401 and reports false.
func (s *Service) requireUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if s.authUser == nil {
		writeError(w, http.StatusServiceUnavailable, "unconfigured", "billing auth is not wired")
		return 0, false
	}
	userID, ok := s.authUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "valid session required")
		return 0, false
	}
	return userID, true
}

// --- provider callback -----------------------------------------------------

// handleWebhook is the only path on which money is ever granted. It is
// unauthenticated by necessity — the provider holds no session — so the
// signature IS the authentication.
func (s *Service) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if name := r.PathValue("provider"); name != s.provider.Name() {
		// Not the configured provider: a stale integration or a probe. Nothing
		// is recorded, because nothing here can be attributed.
		writeError(w, http.StatusNotFound, "no_such_provider", "unknown payment provider")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the callback body")
		return
	}

	granted, err := s.ingest(r.Context(), r.Header, body)
	switch {
	case errors.Is(err, ErrBadSignature):
		// 403 and no detail: an attacker learns nothing about which part failed.
		writeError(w, http.StatusForbidden, "bad_signature", "signature does not verify")
		return
	case errors.Is(err, ErrBadCallback):
		// Authentic but nonsensical. Retrying it would not help the provider.
		writeError(w, http.StatusBadRequest, "invalid_callback", "callback could not be processed")
		return
	case err != nil:
		// The event verified but the grant failed on our side (database down).
		// Answer 500 so the provider retries — the transition is idempotent, so
		// a retry is free, whereas a swallowed error loses a real payment.
		log.Printf("billing: webhook grant failed: %v", err)
		writeError(w, http.StatusInternalServerError, "grant_failed", "could not apply the payment")
		return
	}
	// Verified and settled (or already settled by an earlier delivery): the
	// provider gets the acknowledgement it expects, in its own format.
	s.provider.Ack(w, granted)
}

// --- sandbox: a stand-in for the provider's hosted page --------------------

// handleFakeCheckout renders the sandbox payment page. A real provider serves
// this itself, on its own domain — that is the whole point of a hosted page,
// and why no card data ever reaches us (PAYMENTS-PLAN §4.3).
func (s *Service) handleFakeCheckout(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>anoon sandbox checkout</title>
<body style="font:16px system-ui;max-width:32rem;margin:4rem auto">
<h1>Песочница оплаты</h1>
<p>Заказ <code>%s</code>. Настоящий провайдер показал бы здесь свою платёжную страницу.</p>
<form method="post" action="/billing/fake/pay">
  <input type="hidden" name="order" value="%s">
  <button name="outcome" value="paid">Оплатить</button>
  <button name="outcome" value="failed">Отказаться</button>
</form></body>`, html.EscapeString(orderID), html.EscapeString(orderID))
}

// fakePayHandler settles a sandbox order. It does NOT have a private path into
// the grant: it builds the same callback body a provider would post, signs it
// with the same key, and hands it to the same ingest — so the signature check,
// the amount check and the idempotency guard are all exercised by every
// sandbox payment.
func (s *Service) fakePayHandler(fake *fakeProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_form", "malformed form")
			return
		}
		orderID := r.FormValue("order")
		status := r.FormValue("outcome")
		if status != "paid" {
			status = "failed"
		}

		// The amount is read from the order, exactly as a provider would report
		// back what it actually charged.
		var amount int64
		if !looksLikeUUID(orderID) {
			writeError(w, http.StatusBadRequest, "no_such_order", "order not found")
			return
		}
		if err := s.db.QueryRowContext(r.Context(),
			`SELECT amount_amd FROM orders WHERE id = $1`, orderID).Scan(&amount); err != nil {
			writeError(w, http.StatusNotFound, "no_such_order", "order not found")
			return
		}

		body, _ := json.Marshal(fakeCallback{
			OrderID:   orderID,
			Ref:       "fake-" + orderID,
			AmountAMD: amount,
			Status:    status,
		})
		hdr := http.Header{}
		hdr.Set(fakeSignatureHeader, fake.sign(body))

		granted, err := s.ingest(r.Context(), hdr, body)
		if err != nil {
			log.Printf("billing: sandbox settle %s: %v", orderID, err)
			writeError(w, http.StatusInternalServerError, "grant_failed", "could not apply the sandbox payment")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"orderId": orderID, "status": status, "granted": granted})
	}
}

// --- tiny local copies of the api package's JSON helpers -------------------
// (billing must not import api: api imports billing.)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("billing: encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": code, "message": message})
}
