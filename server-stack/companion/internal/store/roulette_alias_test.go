package store

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The two members of the match under test, and the #IDs they must never be
// described by while the match is anonymous.
const (
	aliceID int64 = 41
	bobID   int64 = 42
)

// anonMatch is a match as CreateMatch would have produced it, without a DB.
func anonMatch() Match {
	return Match{
		ID: 7, Topic: "grpTest", UserA: aliceID, UserB: bobID, Status: "active",
		AliasA: "~K7X2QM", AliasB: "~R4TBHN",
	}
}

// TestAliasForIdentifiesTheRightMember pins which alias stands for whom: AliasFor
// is the handle the peer sees for that member, PeerAlias is what that member
// should be shown in place of their peer's #ID. Swapping the two would show each
// user their own alias and quietly break every anon-phase relay.
func TestAliasForIdentifiesTheRightMember(t *testing.T) {
	m := anonMatch()
	if got := m.AliasFor(aliceID); got != m.AliasA {
		t.Errorf("AliasFor(alice) = %q, want %q", got, m.AliasA)
	}
	if got := m.AliasFor(bobID); got != m.AliasB {
		t.Errorf("AliasFor(bob) = %q, want %q", got, m.AliasB)
	}
	if got := m.PeerAlias(aliceID); got != m.AliasB {
		t.Errorf("PeerAlias(alice) = %q, want bob's alias %q", got, m.AliasB)
	}
	if got := m.PeerAlias(bobID); got != m.AliasA {
		t.Errorf("PeerAlias(bob) = %q, want alice's alias %q", got, m.AliasA)
	}
	// A non-member gets nothing rather than an arbitrary member's alias.
	if got := m.AliasFor(999); got != "" {
		t.Errorf("AliasFor(non-member) = %q, want empty", got)
	}
	if got := m.PeerAlias(999); got != "" {
		t.Errorf("PeerAlias(non-member) = %q, want empty", got)
	}
}

// TestAnonEndsOnlyAtReveal is the switch every caller keys the real #ID off. An
// ended match is still anonymous — the pair never consented, and the chat's
// history and any moderation follow-up must not retroactively name them.
func TestAnonEndsOnlyAtReveal(t *testing.T) {
	for _, status := range []string{"active", "ended"} {
		m := Match{Status: status}
		if !m.Anon() {
			t.Errorf("status %q must still be anonymous", status)
		}
	}
	if (Match{Status: "revealed"}).Anon() {
		t.Error("a revealed match must not be anonymous")
	}
}

// TestNewAnonAliasShape covers the format H2's fix depends on: an alias must be
// impossible to mistake for a real "#00012" #ID, since the UI renders whichever
// handle it is given verbatim.
func TestNewAnonAliasShape(t *testing.T) {
	for i := 0; i < 200; i++ {
		a, err := newAnonAlias()
		if err != nil {
			t.Fatalf("newAnonAlias: %v", err)
		}
		if !strings.HasPrefix(a, AliasSigil) {
			t.Fatalf("alias %q must start with %q, not look like a #ID", a, AliasSigil)
		}
		if strings.HasPrefix(a, "#") {
			t.Fatalf("alias %q must never wear the #ID sigil", a)
		}
		if len(a) != len(AliasSigil)+aliasLen {
			t.Fatalf("alias %q has length %d, want %d", a, len(a), len(AliasSigil)+aliasLen)
		}
		for _, r := range strings.TrimPrefix(a, AliasSigil) {
			if !strings.ContainsRune(aliasAlphabet, r) {
				t.Fatalf("alias %q contains %q, outside the alphabet", a, r)
			}
		}
	}
}

// TestNewAnonAliasIsNotCorrelatable is the "a returning peer must not be
// recognisable" requirement: nothing about an alias is derived from the user, so
// two draws must not collide. 6 chars over 32 symbols is ~1e9 values, so 500
// draws colliding means the generator lost its entropy (e.g. a seeded PRNG).
func TestNewAnonAliasIsNotCorrelatable(t *testing.T) {
	seen := make(map[string]bool, 500)
	for i := 0; i < 500; i++ {
		a, err := newAnonAlias()
		if err != nil {
			t.Fatalf("newAnonAlias: %v", err)
		}
		if seen[a] {
			t.Fatalf("alias %q drawn twice in 500 draws — aliases are correlatable", a)
		}
		seen[a] = true
	}
}

// TestNormalizeAlias guards the one place a client-supplied handle is accepted as
// an alias. A "#ID" spelling must never normalize into an alias, or the alias
// field would become a second way to name a real account.
func TestNormalizeAlias(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"~K7X2QM", "~K7X2QM"},
		{"  ~k7x2qm  ", "~K7X2QM"}, // clients may lowercase or pad
		{"K7X2QM", ""},             // sigil is required
		{"#00012", ""},
		{"00012", ""},
		{"12", ""},
		// An all-digit draw is possible; the sigil is what keeps it from ever
		// being read as a #ID, which is why it is mandatory above.
		{"~234567", "~234567"},
		{"~K7X2Q", ""}, // too short
		{"~K7X2QMZ", ""},
		{"~K7X2Q0", ""}, // 0 is excluded as ambiguous
		{"~K7X2QI", ""}, // I is excluded as ambiguous
		{"", ""},
		{"~", ""},
	}
	for _, tc := range tests {
		if got := NormalizeAlias(tc.in); got != tc.want {
			t.Errorf("NormalizeAlias(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// aliasMigration is the migration that gives pre-0010 rows an alias and supplies
// the column DEFAULT for any row inserted without one. The test below reads the
// real file rather than a copy of its logic — a copy would have agreed with
// itself while the shipped SQL was wrong.
const aliasMigration = "../db/migrations/0010_roulette_anon_alias.sql"

// translateRe pulls the character mapping out of the migration's alias
// generator: translate(<expr>, '<from>', '<to>'). The first argument nests its
// own parens and commas, so the mapping is found as the first pair of quoted
// literals inside the call.
var translateRe = regexp.MustCompile(`(?s)translate\(.*?'([^']*)'\s*,\s*'([^']*)'\s*\)`)

// commentRe matches SQL line comments. The assertions below must run against
// executable SQL only: this migration's header documents the broken generator it
// replaces, and a scan of the raw text would match that prose and fail. (Naive
// about `--` inside a string literal; this file has none.)
var commentRe = regexp.MustCompile(`(?m)--.*$`)

// migrationSQL reads the alias migration and strips its comments.
func migrationSQL(t *testing.T) string {
	t.Helper()
	src, err := os.ReadFile(aliasMigration)
	if err != nil {
		t.Fatalf("read %s: %v", aliasMigration, err)
	}
	return commentRe.ReplaceAllString(string(src), "")
}

// TestMigrationAliasesNormalizeToThemselves is the invariant that was missing:
// every alias the database can put in the column must survive NormalizeAlias
// unchanged. It did not hold. The generator was
// '~' || upper(substr(md5(random()::text), 1, 6)) — md5 is hex, so it emits 0
// and 1, which aliasAlphabet deliberately excludes. Around 55% of backfilled
// rows ((14/16)^6 survive) got an alias the server itself refuses to parse, so
// MatchByPeerAlias returned ErrNoMatch and alias-addressed call/activity frames
// silently failed in any match that predated the migration.
//
// This checks the shipped SQL, so it also covers the DEFAULT clause — every
// future row inserted without an explicit alias comes from the same generator.
func TestMigrationAliasesNormalizeToThemselves(t *testing.T) {
	sql := migrationSQL(t)

	// The raw-hex generator must be gone, not merely supplemented.
	if regexp.MustCompile(`'~'\s*\|\|\s*upper\(\s*substr\(\s*md5`).MatchString(sql) {
		t.Error("migration concatenates md5 hex straight into an alias; hex contains 0 and 1, which NormalizeAlias rejects")
	}

	maps := translateRe.FindAllStringSubmatch(sql, -1)
	if len(maps) == 0 {
		t.Fatalf("no translate() mapping found in %s — the generator must map its source alphabet into aliasAlphabet", aliasMigration)
	}

	for _, m := range maps {
		from, to := m[1], m[2]

		// A source symbol with no counterpart passes through translate()
		// unchanged, which is exactly how an out-of-alphabet character would
		// get back in.
		if len(from) != len(to) {
			t.Errorf("translate('%s','%s'): lists differ in length (%d vs %d); unmapped symbols pass through unchanged", from, to, len(from), len(to))
		}
		for _, r := range "0123456789ABCDEF" {
			if !strings.ContainsRune(from, r) {
				t.Errorf("translate source %q does not cover hex symbol %q; it would survive into the alias", from, r)
			}
		}
		for _, r := range to {
			if !strings.ContainsRune(aliasAlphabet, r) {
				t.Errorf("translate target %q contains %q, which is outside aliasAlphabet %q", to, r, aliasAlphabet)
			}
		}

		// Every alias the mapping can produce must round-trip. The target set is
		// small, so walk every window of it rather than sampling.
		for i := range to {
			var sb strings.Builder
			sb.WriteString(AliasSigil)
			for j := 0; j < aliasLen; j++ {
				sb.WriteByte(to[(i+j)%len(to)])
			}
			alias := sb.String()
			if got := NormalizeAlias(alias); got != alias {
				t.Errorf("NormalizeAlias(%q) = %q, want it unchanged — the migration can write this value", alias, got)
			}
		}
	}
}

// TestMigrationKeepsRowAliasesDistinct: the two members of one match have to be
// tellable apart, or a moderation record cannot say which of them did what. The
// migration states it as a CHECK rather than trusting two independent draws, and
// redraws once before adding the constraint so an unlucky backfill is corrected
// instead of failing the migration.
func TestMigrationKeepsRowAliasesDistinct(t *testing.T) {
	sql := migrationSQL(t)

	if !regexp.MustCompile(`CHECK\s*\(\s*alias_a\s*<>\s*alias_b\s*\)`).MatchString(sql) {
		t.Error("migration does not constrain alias_a <> alias_b")
	}
	if !regexp.MustCompile(`UPDATE\s+roulette_matches\s+SET\s+alias_b\s*=.*WHERE\s+alias_a\s*=\s*alias_b`).MatchString(sql) {
		t.Error("migration adds the distinctness constraint without first redrawing colliding backfilled rows")
	}
}
