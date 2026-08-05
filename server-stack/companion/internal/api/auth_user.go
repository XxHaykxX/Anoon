package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"anoon/companion/internal/store"
)

// errUnauthenticated is returned when a request carries no resolvable identity.
var errUnauthenticated = errors.New("unauthenticated")

// authUser resolves the calling anoon user from the request. The frontend holds
// a Tinode login token (minted by Tinode at login); it presents it as
// `Authorization: Bearer <token>` (or, for the WebSocket, a `?token=` query
// param). We validate it by resolving it to a Tinode UID via a throwaway Tinode
// session, then map that UID to the companion user.
//
// Dev shortcut: when COMPANION_DEV_AUTH is enabled, an `X-Anoon-Uid` (Tinode uid)
// or `X-Anoon-Hash-Id` (#ID number) header is accepted directly, so the frontend
// and manual testing can run before token wiring against the live stack. This
// bypass is refused unless the dev flag is set.
func (s *Server) authUser(ctx context.Context, r *http.Request) (store.User, error) {
	if s.DevAuth {
		if h := r.Header.Get("X-Anoon-Uid"); h != "" {
			return s.Store.UserByTinodeUID(ctx, h)
		}
		if h := r.Header.Get("X-Anoon-Hash-Id"); h != "" {
			n, err := strconv.ParseInt(strings.TrimPrefix(h, "#"), 10, 64)
			if err != nil {
				return store.User{}, errUnauthenticated
			}
			return s.Store.UserByHashID(ctx, n)
		}
	}

	token := bearerToken(r)
	if token == "" {
		return store.User{}, errUnauthenticated
	}
	uid, err := s.Tinode.ResolveToken(ctx, token)
	if err != nil {
		return store.User{}, errUnauthenticated
	}
	return s.Store.UserByTinodeUID(ctx, uid)
}

// bearerToken extracts the token from the Authorization header or ?token= query.
func bearerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if strings.HasPrefix(h, "Bearer ") {
			return strings.TrimSpace(h[len("Bearer "):])
		}
	}
	return r.URL.Query().Get("token")
}

// requireUser resolves the caller or writes a 401 and returns ok=false.
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	u, err := s.authUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "valid session required")
		return store.User{}, false
	}
	// Presence heartbeat: every authenticated REST call refreshes last_seen.
	s.touchPresence(u.ID)
	return u, true
}
