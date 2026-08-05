package api

import "testing"

func TestMessagePreview(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"empty", "", "New message"},
		{"plain string", `"hello there"`, "hello there"},
		{"drafty txt", `{"txt":"hi from drafty","fmt":[]}`, "hi from drafty"},
		{"drafty no txt", `{"ent":[{"tp":"IM"}]}`, "New message"},
		{"non-json", "not json at all", "New message"},
		{"drafty blank txt", `{"txt":"   "}`, "New message"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := messagePreview([]byte(tc.content)); got != tc.want {
				t.Fatalf("messagePreview(%q) = %q, want %q", tc.content, got, tc.want)
			}
		})
	}
}

func TestTruncatePreview(t *testing.T) {
	if got := truncatePreview("short", 120); got != "short" {
		t.Fatalf("short string should pass through, got %q", got)
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "a"
	}
	got := truncatePreview(long, 10)
	// 10 runes + the ellipsis.
	if len([]rune(got)) != 11 {
		t.Fatalf("truncated preview should be 10 runes + ellipsis, got %d runes (%q)", len([]rune(got)), got)
	}
}
