package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// wsUpgrader builds the /ws upgrader for this server. CheckOrigin enforces the
// same allowlist as CORS (config.CORSAllowedOrigins): in prod the single
// Caddy-served origin, in dev localhost plus the *.trycloudflare.com tunnels
// used for phone testing. The upgrader is cheap to build and only constructed
// once per socket, which is what lets the closure see the per-server allowlist.
func (s *Server) wsUpgrader() websocket.Upgrader {
	allowed := s.CORSAllowedOrigins
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return wsOriginAllowed(r.Header.Get("Origin"), allowed)
		},
	}
}

// wsOriginAllowed is the /ws origin gate: the CORS allowlist (see
// originAllowed) plus the no-Origin case. Browsers always send Origin on a
// WebSocket handshake, so an absent one means a non-browser client (the native
// app, curl, a probe) — a caller the header could never have protected against
// anyway, since it is under that client's own control. Rejecting it would break
// the native app for no gain; /ws stays authenticated by Tinode token either
// way, and the origin check is the layer that stops a foreign *page* from
// riding a browser's ambient credentials.
func wsOriginAllowed(origin string, allowed []string) bool {
	if origin == "" {
		return true
	}
	return originAllowed(origin, allowed)
}

// wsClient is one live socket. The hub pushes marshalled events onto send; the
// write pump drains them to the wire.
type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

const (
	wsPongWait   = 60 * time.Second
	wsPingPeriod = 50 * time.Second
	wsWriteWait  = 10 * time.Second
	wsSendBuffer = 32
)

// handleWS authenticates the socket (Tinode token in ?token= or Authorization),
// registers it in the hub under the user id, and pumps events until close.
// It is the delivery channel for anoon realtime events (matched, reveal_request,
// revealed, friend_request) and the source of the anon-phase online dot.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	u, err := s.authUser(r.Context(), r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "valid session required")
		return
	}

	up := s.wsUpgrader()
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		// Includes a rejected Origin, which Upgrade answers with 403 itself.
		log.Printf("ws: upgrade failed (origin=%q): %v", r.Header.Get("Origin"), err)
		return
	}

	client := &wsClient{conn: conn, send: make(chan []byte, wsSendBuffer)}
	s.Hub.add(u.ID, client)
	// Presence heartbeat: stamp on connect and on each keepalive pong, so a
	// long-lived socket keeps the user's last_seen fresh for the admin online view.
	s.touchPresence(u.ID)
	defer func() {
		s.Hub.remove(u.ID, client)
		conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		s.touchPresence(u.ID)
		return nil
	})

	// Write pump: events from the hub + periodic pings.
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(wsPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case payload := <-client.send:
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
					return
				}
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Read pump: the client is otherwise receive-only, but WebRTC call signaling
	// frames (call:offer/answer/ice/hangup) travel up this same socket — see
	// handleWSFrame. Exit on close/error, which tears down the write pump too.
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		s.handleWSFrame(r.Context(), u, raw)
	}
	close(done)
}
