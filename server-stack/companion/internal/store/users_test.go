package store

import "testing"

func TestFormatHashID(t *testing.T) {
	cases := map[int64]string{
		1:      "#00001",
		42:     "#00042",
		99999:  "#99999",
		100000: "#100000", // overflow widens, no format migration
	}
	for n, want := range cases {
		if got := FormatHashID(n); got != want {
			t.Errorf("FormatHashID(%d) = %q, want %q", n, got, want)
		}
	}
}
