package api

import (
	"encoding/json"
	"log"
	"net/http"
)

// validReportCategory is the closed set the reports table CHECK enforces; we
// reject early so a bad category is a 400, not a 500 from the DB constraint.
var validReportCategory = map[string]bool{
	"spam": true, "abuse": true, "sexual": true, "illegal": true, "other": true,
}

// createReportRequest is the body of POST /reports (must match the frontend).
type createReportRequest struct {
	ReportedHashID string `json:"reportedHashId"` // e.g. "#00003" or "3"
	Category       string `json:"category"`       // spam|abuse|sexual|illegal|other
	Topic          string `json:"topic"`          // optional: where it happened
	Details        string `json:"details"`        // optional free text
}

// handleCreateReport lets an authenticated user report another user. It resolves
// the reported #ID to a companion user, validates the category, and inserts an
// open report. Responds { "id": <reportId> }.
func (s *Server) handleCreateReport(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req createReportRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if !validReportCategory[req.Category] {
		writeError(w, http.StatusBadRequest, "invalid_category", "category must be spam|abuse|sexual|illegal|other")
		return
	}
	hashNum, err := parseHashID(req.ReportedHashID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash_id", "reportedHashId is required and must be a #ID")
		return
	}

	ctx := r.Context()
	reported, err := s.Store.UserByHashID(ctx, hashNum)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_such_user", "reported user not found")
		return
	}
	if reported.ID == u.ID {
		writeError(w, http.StatusBadRequest, "self_report", "cannot report yourself")
		return
	}

	id, err := s.Store.CreateReport(ctx, u.ID, reported.ID, req.Category, req.Topic, req.Details)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save report")
		return
	}

	// Best-effort: flag any media in the reported topic as escalated so the
	// view-once/TTL cleanup path can't purge it before a moderator reviews the
	// report (COMPANION-ADMIN-API.md §4). Never fails the report itself.
	if err := s.Store.EscalateMediaByTopic(ctx, req.Topic); err != nil {
		log.Printf("reports: escalate media for topic %q: %v", req.Topic, err)
	}

	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}
