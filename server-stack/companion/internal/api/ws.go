package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// upgrader upgrades /ws requests to WebSocket. CheckOrigin is permissive for
// now (dev); tighten to the anoon frontend origin before prod.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
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

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade failed: %v", err)
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
