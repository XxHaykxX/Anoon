package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"anoon/companion/internal/store"
)

// validReportCategory is the closed set the reports table CHECK enforces; we
// reject early so a bad category is a 400, not a 500 from the DB constraint.
var validReportCategory = map[string]bool{
	"spam": true, "abuse": true, "sexual": true, "illegal": true, "other": true,
}

// createReportRequest is the body of POST /reports (must match the frontend).
// One of reportedHashId or topic must identify the target. A friend chat sends
// the peer's real #ID; the roulette's anonymous phase sends only the topic,
// because after H2 the client holds a per-match alias and no #ID for the peer —
// so the conversation is what says who is being reported. See reportTarget.
type createReportRequest struct {
	ReportedHashID string `json:"reportedHashId"` // e.g. "#00003" or "3"; absent while anonymous
	Category       string `json:"category"`       // spam|abuse|sexual|illegal|other
	Topic          string `json:"topic"`          // where it happened; required when no #ID
	Details        string `json:"details"`        // optional free text
}

// handleCreateReport lets an authenticated user report another user. It resolves
// who is being reported, validates the category, and inserts an open report.
// Responds { "id": <reportId> }.
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
	ctx := r.Context()

	// Where the report happened, and whether the reporter was really there.
	// Needed twice below: to resolve an anonymous peer, and to decide whether
	// the report may escalate the conversation's media.
	var member topicMember
	var inTopic bool
	if req.Topic != "" {
		member, inTopic = topicMemberFor(ctx, s.Store, u, req.Topic)
	}

	var reportedID int64
	switch reportTarget(req.ReportedHashID, req.Topic, inTopic) {
	case targetFromHashID:
		hashNum, err := parseHashID(req.ReportedHashID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_hash_id", "reportedHashId must be a #ID")
			return
		}
		reported, err := s.Store.UserByHashID(ctx, hashNum)
		if err != nil {
			writeError(w, http.StatusNotFound, "no_such_user", "reported user not found")
			return
		}
		reportedID = reported.ID
	case targetFromTopic:
		reportedID = member.PeerID
	case targetNotInTopic:
		writeError(w, http.StatusNotFound, "no_match", "that topic is not a conversation you are in")
		return
	default:
		writeError(w, http.StatusBadRequest, "missing_target", "reportedHashId or topic is required")
		return
	}
	if reportedID == u.ID {
		writeError(w, http.StatusBadRequest, "self_report", "cannot report yourself")
		return
	}

	id, err := s.Store.CreateReport(ctx, u.ID, reportedID, req.Category, req.Topic, req.Details)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save report")
		return
	}

	// Best-effort: flag the media exchanged in the reported conversation as
	// escalated so the view-once/TTL cleanup path can't purge it before a
	// moderator reviews the report (COMPANION-ADMIN-API.md §4). Never fails the
	// report itself.
	//
	// Filing a report is open to anyone — it is a claim, and refusing it would
	// only hide abuse — but escalation is not: the flag is what suspends the
	// "this will disappear" guarantee on view-once media, so it reaches only a
	// conversation the reporter was in with the person they are reporting.
	if req.Topic != "" {
		if inTopic && member.PeerID == reportedID {
			s.escalateReportedMedia(ctx, u, member, req.Topic)
		} else {
			log.Printf("reports: not escalating topic %q: user %d is not in it with user %d",
				req.Topic, u.ID, reportedID)
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// reportTargetSource says where handleCreateReport takes the reported user from.
type reportTargetSource int

const (
	// targetFromHashID — the client sent the peer's real #ID. This is the
	// friend-chat case, and the anonymous roulette phase can never reach it:
	// after H2 the client holds only a per-match alias, which resolves to an
	// account nowhere on the wire.
	targetFromHashID reportTargetSource = iota
	// targetFromTopic — no #ID, but the caller is a member of the topic they
	// named, so the person they are reporting is the other member. This is how
	// an anonymous chat is reported without ever naming an account.
	targetFromTopic
	// targetNotInTopic — a topic was named and the caller is not in it. There
	// is nobody to report: resolving the peer anyway would hand out the
	// membership of arbitrary conversations.
	targetNotInTopic
	// targetMissing — neither a #ID nor a topic.
	targetMissing
)

// reportTarget picks how a report identifies its subject. Split out from the
// handler so the choice is unit-testable: both ways in must keep working, and
// the failure mode of getting it wrong is a moderation path that silently 400s.
func reportTarget(hashID, topic string, inTopic bool) reportTargetSource {
	switch {
	case hashID != "":
		return targetFromHashID
	case inTopic:
		return targetFromTopic
	case topic != "":
		return targetNotInTopic
	default:
		return targetMissing
	}
}

// escalateReportedMedia flags the media the reporter exchanged with the peer of
// `member` in `topic`, so a moderator still has it to look at. The caller must
// have established that the reporter is in that conversation with the person
// being reported. Everything here is best-effort and logged — a report is never
// failed over its side effects.
func (s *Server) escalateReportedMedia(ctx context.Context, reporter store.User, member topicMember, topic string) {
	for _, leg := range escalationLegs(member, reporter, topic) {
		var err error
		if leg.owner == 0 {
			err = s.Store.EscalateMediaByTopic(ctx, leg.topic)
		} else {
			err = s.Store.EscalateMediaByTopicOwner(ctx, leg.topic, leg.owner)
		}
		if err != nil {
			log.Printf("reports: escalate media for topic %q owner %d: %v", leg.topic, leg.owner, err)
		}
	}
}

// escalationLeg is one selection of media_assets rows to flag: a topic, and the
// owner whose rows within it are meant. owner 0 means every owner in the topic.
type escalationLeg struct {
	topic string
	owner int64
}

// escalationLegs works out which media a report on `topic` covers. The answer
// depends on the topic shape, because the two shapes name conversations
// differently:
//
//   - Roulette (grpXXX): one name, shared by both members and unique to the
//     pairing — a single topic-wide leg is exactly this conversation's media.
//   - Tinode p2p (usrXXX): names are per-user. The chat the reporter calls
//     `topic` (the reported user's uid) is the one the reported user calls by
//     the reporter's uid, and each side files its media under the name it uses,
//     so `topic` alone means "everything anyone sent to that peer". Hence two
//     owner-scoped legs, one per member: a topic-wide sweep would reach into
//     unrelated chats while still missing the reported user's own media.
func escalationLegs(member topicMember, reporter store.User, topic string) []escalationLeg {
	if !member.P2P {
		return []escalationLeg{{topic: topic}}
	}
	legs := []escalationLeg{{topic: topic, owner: reporter.ID}}
	if reporter.TinodeUID != "" {
		// Without the reporter's own uid we cannot name their side of the p2p
		// chat, so the reported user's media stays unflagged rather than being
		// guessed at.
		legs = append(legs, escalationLeg{topic: reporter.TinodeUID, owner: member.PeerID})
	}
	return legs
}
