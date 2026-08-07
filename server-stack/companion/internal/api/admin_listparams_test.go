package api

import (
	"net/http/httptest"
	"testing"
)

// TestParseListParamsIDs pins the `ids` set (COMPANION-ADMIN-API.md §1 —
// Refine's getMany). The property that matters is presence, not value: once the
// caller has named a set, an unparseable or empty one must answer with nothing
// rather than degrade into an ordinary page of everything.
func TestParseListParamsIDs(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  []int64 // nil = no restriction
	}{
		{"absent", "", nil},
		{"csv", "?ids=3,7,11", []int64{3, 7, 11}},
		{"spaces and blanks", "?ids=%203%20,,7", []int64{3, 7}},
		{"filter spelling", "?f_ids=5", []int64{5}},
		{"present but empty", "?ids=", []int64{}},
		{"present but junk", "?ids=abc,%234", []int64{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseListParams(httptest.NewRequest("GET", "/admin/users"+tc.query, nil)).IDs
			if (got == nil) != (tc.want == nil) {
				t.Fatalf("IDs = %v (nil=%v), want %v (nil=%v) — nil and empty mean different things",
					got, got == nil, tc.want, tc.want == nil)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("IDs = %v, want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("IDs = %v, want %v", got, tc.want)
				}
			}
		})
	}
}

// TestParseListParamsIDsAreCapped: the set arrives in a URL and becomes one
// placeholder each, so it is bounded here rather than by whatever the caller
// manages to fit in a request line.
func TestParseListParamsIDsAreCapped(t *testing.T) {
	query := "?ids="
	for i := 0; i < maxListIDs+50; i++ {
		if i > 0 {
			query += ","
		}
		query += "1"
	}
	if got := parseListParams(httptest.NewRequest("GET", "/admin/users"+query, nil)).IDs; len(got) != maxListIDs {
		t.Fatalf("len(IDs) = %d, want the cap %d", len(got), maxListIDs)
	}
}
