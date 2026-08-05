package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// writeJSON writes v as a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("api: encode response: %v", err)
	}
}

// handleHealth reports liveness and DB reachability.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := "ok"
	dbOK := true
	if s.DB != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.DB.PingContext(ctx); err != nil {
			dbOK = false
			status = "degraded"
		}
	}
	code := http.StatusOK
	if !dbOK {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{
		"status":  status,
		"service": "companion",
		"db":      dbOK,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

// writeError writes a JSON error envelope with a machine code and human message.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error":   code,
		"message": message,
	})
}

// stub returns a handler that responds 501 with the endpoint name, so the
// frontend can integrate against the route shape before logic lands.
func (s *Server) stub(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"error":    "not_implemented",
			"endpoint": name,
		})
	}
}
