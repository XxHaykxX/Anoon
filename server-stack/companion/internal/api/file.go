package api

// file.go serves one attachment to the admin panel.
//
// Everything else the panel shows is companion's own data; an attachment is a
// file on Tinode, and Tinode will not hand it to the operator's browser — the
// download handler wants an api key and a logged-in session, and an operator
// has no Tinode account. So companion fetches it as ROOT and streams it
// through, which also means a moderator's browser never sees a credential.
//
// Read-only, gated like every other /admin/* route. Not journalled: opening a
// conversation or a gallery page is what gets recorded, and the image loads
// that follow are the same act, not new ones.

import (
	"io"
	"log"
	"net/http"
	"strings"
)

// handleAdminFile streams GET /admin/file?ref=/v0/file/s/<id>.
func (s *Server) handleAdminFile(w http.ResponseWriter, r *http.Request) {
	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	// The same validator POST /media accepts refs with: this ref reached us via
	// a chat message or the media registry, so it is data, not a constant.
	if !validMediaURL(ref) {
		writeError(w, http.StatusBadRequest, "invalid_ref", "not a Tinode file ref")
		return
	}

	body, contentType, err := s.Tinode.FetchFile(r.Context(), ref)
	if err != nil {
		log.Printf("admin: fetch file %s: %v", ref, err)
		writeError(w, http.StatusBadGateway, "tinode_failed", "could not fetch the file")
		return
	}
	defer func() { _ = body.Close() }()

	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	// A ref is immutable — the id is content-addressed by the upload — so the
	// panel may cache it for as long as it likes. Private: this is one person's
	// attachment travelling through a shared service.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if _, err := io.Copy(w, body); err != nil {
		// Headers are already out; all that is left is to say so in the log.
		log.Printf("admin: stream file %s: %v", ref, err)
	}
}
