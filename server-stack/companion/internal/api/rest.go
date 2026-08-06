package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"anoon/companion/internal/store"
)

// This file implements the server-to-server endpoint that Tinode's `rest` auth
// scheme calls (see server/server/auth/rest/auth_rest.go). Tinode POSTs a JSON
// request with an `endpoint` discriminator; we answer with the response shape it
// expects. anoon uses the `rest` scheme for Google sign-in: the login `secret`
// carried by Tinode is the Google ID token.
//
// Uid representation: in this rest JSON the uid is the *bare* base64 form
// (types.Uid.MarshalJSON), whereas our gRPC `{acc}` path uses the "usr"-prefixed
// form. They differ only by the "usr" prefix, so we convert at the boundary and
// store the prefixed form everywhere internally.

// restRec mirrors auth.Rec. uid as a string round-trips types.Uid's JSON
// (a bare-base64 quoted string); authlvl/features are quoted enum strings.
type restRec struct {
	Uid       string   `json:"uid,omitempty"`
	AuthLevel string   `json:"authlvl,omitempty"`  // "anon" | "auth" | "root"
	Features  string   `json:"features,omitempty"` // "V" validated, "L" no-login
	Tags      []string `json:"tags,omitempty"`
}

// restNewAcc mirrors rest.newAccount: parameters for account auto-creation.
type restNewAcc struct {
	Auth    string `json:"auth,omitempty"` // default access granted to authenticated users
	Anon    string `json:"anon,omitempty"` // default access for anonymous
	Public  any    `json:"public,omitempty"`
	Private any    `json:"private,omitempty"`
}

// restRequest mirrors rest.request.
type restRequest struct {
	Endpoint   string   `json:"endpoint"`
	Name       string   `json:"name"`
	Record     *restRec `json:"rec,omitempty"`
	Secret     []byte   `json:"secret,omitempty"` // JSON base64; string(...) = the login secret
	RemoteAddr string   `json:"addr,omitempty"`
}

// restResponse mirrors rest.response.
type restResponse struct {
	Err     string      `json:"err,omitempty"`
	Record  *restRec    `json:"rec,omitempty"`
	ByteVal []byte      `json:"byteval,omitempty"`
	Ts      time.Time   `json:"ts,omitempty"`
	BoolVal bool        `json:"boolval,omitempty"`
	StrArr  []string    `json:"strarr,omitempty"`
	NewAcc  *restNewAcc `json:"newacc,omitempty"`
}

const oauthProvider = "google"

// restSecretHeader is the header a caller that can set headers should use to
// present COMPANION_REST_SECRET. Tinode cannot (see restOnly), so it is not the
// only accepted position — but it is the documented one.
const restSecretHeader = "X-Companion-Rest-Secret"

// restOnly wraps the rest-auth hook with the shared-secret gate, the same way
// adminOnly (admin.go) gates /admin/*: no secret configured disables the whole
// surface (503) rather than letting callers through, a wrong/absent secret is
// 401, and the comparison is constant time.
//
// This hook is NOT public. It is called server-to-server by Tinode over the
// internal docker network, and `del` unlinks a user's OAuth identity by uid
// alone — a uid every chat partner already knows, since a p2p topic name is
// the peer's uid. Without this gate an anonymous caller can permanently lock
// someone out of Google sign-in.
//
// Where the secret travels: Tinode's rest authenticator cannot set request
// headers — it POSTs with net/http's default client and its config carries only
// server_url/allow_new_accounts/use_separate_endpoints (see
// server/server/auth/rest/auth_rest.go). It does carry the URL's userinfo,
// which net/http turns into an `Authorization: Basic` header, so the secret is
// accepted from the basic-auth password as well as from restSecretHeader.
func (s *Server) restOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.RestSecret == "" {
			writeError(w, http.StatusServiceUnavailable, "rest_auth_disabled", "rest auth hook is disabled")
			return
		}
		got := presentedRestSecret(r)
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.RestSecret)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid rest auth secret")
			return
		}
		next(w, r)
	}
}

// presentedRestSecret returns the secret the request carries, preferring the
// explicit header and falling back to the basic-auth password Tinode delivers
// via its server_url userinfo. Returns "" when neither is present.
func presentedRestSecret(r *http.Request) string {
	if got := r.Header.Get(restSecretHeader); got != "" {
		return got
	}
	_, pass, _ := r.BasicAuth()
	return pass
}

// handleAuthRest dispatches the rest-auth JSON-RPC by its endpoint field.
// All responses are HTTP 200 with a JSON body (logical errors travel in `err`);
// Tinode treats a non-2xx status as a hard transport failure.
func (s *Server) handleAuthRest(w http.ResponseWriter, r *http.Request) {
	var req restRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "malformed"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	switch req.Endpoint {
	case "auth":
		s.restAuth(ctx, w, &req)
	case "link":
		s.restLink(ctx, w, &req)
	case "checkunique":
		s.restCheckUnique(ctx, w, &req)
	case "del":
		s.restDel(ctx, w, &req)
	case "add", "upd":
		// Not used by the token scheme; echo the record back unchanged.
		writeJSON(w, http.StatusOK, restResponse{Record: req.Record})
	case "gen":
		// We do not generate secrets (the client presents the Google token).
		writeJSON(w, http.StatusOK, restResponse{})
	case "rtagns":
		// No restricted tag namespaces exposed by this authenticator.
		writeJSON(w, http.StatusOK, restResponse{StrArr: []string{}})
	default:
		writeJSON(w, http.StatusOK, restResponse{Err: "malformed"})
	}
}

// restAuth validates the Google ID token and resolves it to a Tinode account,
// asking Tinode to auto-create one on first sign-in (which then calls `link`).
func (s *Server) restAuth(ctx context.Context, w http.ResponseWriter, req *restRequest) {
	if s.Google == nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "unsupported"})
		return
	}
	id, err := s.Google.Verify(ctx, string(req.Secret))
	if err != nil {
		log.Printf("auth/rest: google verify failed: %v", err)
		writeJSON(w, http.StatusOK, restResponse{Err: "invalid login"})
		return
	}

	user, found, err := s.Store.OAuthUserByIdentity(ctx, oauthProvider, id.Subject)
	if err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "internal"})
		return
	}
	if found {
		writeJSON(w, http.StatusOK, restResponse{Record: &restRec{
			Uid:       bareUID(user.TinodeUID),
			AuthLevel: "auth",
			Features:  "V", // Google-verified account is considered validated
		}})
		return
	}

	// First sign-in: only proceed if the app already captured gender/age via the
	// broker. Otherwise the client must complete registration first.
	pending, err := s.Store.PendingExists(ctx, oauthProvider, id.Subject)
	if err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "internal"})
		return
	}
	if !pending {
		writeJSON(w, http.StatusOK, restResponse{Err: "not found"})
		return
	}

	// Ask Tinode to create the account (uid left zero). Tinode then calls `link`.
	writeJSON(w, http.StatusOK, restResponse{
		Record: &restRec{AuthLevel: "auth", Features: "V"},
		NewAcc: &restNewAcc{Auth: "JRWPA", Anon: "N"},
	})
}

// restLink runs after Tinode created the account: persist the identity mapping
// and allocate the #ID. Tinode passes the new (bare) uid and the same secret.
func (s *Server) restLink(ctx context.Context, w http.ResponseWriter, req *restRequest) {
	if s.Google == nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "unsupported"})
		return
	}
	if req.Record == nil || req.Record.Uid == "" {
		writeJSON(w, http.StatusOK, restResponse{Err: "malformed"})
		return
	}
	id, err := s.Google.Verify(ctx, string(req.Secret))
	if err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "invalid login"})
		return
	}

	user, err := s.Store.LinkOAuthUser(ctx, oauthProvider, id.Subject, id.Email, prefixUID(req.Record.Uid))
	if errors.Is(err, store.ErrNoPending) {
		writeJSON(w, http.StatusOK, restResponse{Err: "not found"})
		return
	}
	if err != nil {
		log.Printf("auth/rest: link failed: %v", err)
		writeJSON(w, http.StatusOK, restResponse{Err: "internal"})
		return
	}
	log.Printf("auth/rest: linked google user, #ID=%s uid=%s", store.FormatHashID(user.HashID), req.Record.Uid)
	writeJSON(w, http.StatusOK, restResponse{Record: req.Record})
}

// restCheckUnique reports whether the identity is not yet registered.
func (s *Server) restCheckUnique(ctx context.Context, w http.ResponseWriter, req *restRequest) {
	if s.Google == nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "unsupported"})
		return
	}
	id, err := s.Google.Verify(ctx, string(req.Secret))
	if err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "invalid login"})
		return
	}
	_, found, err := s.Store.OAuthUserByIdentity(ctx, oauthProvider, id.Subject)
	if err != nil {
		writeJSON(w, http.StatusOK, restResponse{Err: "internal"})
		return
	}
	writeJSON(w, http.StatusOK, restResponse{BoolVal: !found})
}

// restDel removes the OAuth identity for a deleted account.
func (s *Server) restDel(ctx context.Context, w http.ResponseWriter, req *restRequest) {
	if req.Record != nil && req.Record.Uid != "" {
		if err := s.Store.UnlinkOAuthByTinodeUID(ctx, prefixUID(req.Record.Uid)); err != nil {
			log.Printf("auth/rest: del failed: %v", err)
			writeJSON(w, http.StatusOK, restResponse{Err: "internal"})
			return
		}
	}
	writeJSON(w, http.StatusOK, restResponse{})
}

// bareUID strips the "usr" prefix to get the rest-JSON uid form.
func bareUID(prefixed string) string {
	return strings.TrimPrefix(prefixed, "usr")
}

// prefixUID adds the "usr" prefix to a bare rest-JSON uid.
func prefixUID(bare string) string {
	if bare == "" {
		return ""
	}
	return "usr" + bare
}
