package sshsession

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExpandUserPath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home directory")
	}
	cases := map[string]string{
		"~/.ssh/id_ed25519": filepath.Join(home, ".ssh", "id_ed25519"),
		"~":                 home,
		"/etc/ssh/key":      "/etc/ssh/key",
		"relative/key":      "relative/key",
		"":                  "",
		"  ~/k  ":           filepath.Join(home, "k"),
	}
	for in, want := range cases {
		if got := ExpandUserPath(in); got != want {
			t.Errorf("ExpandUserPath(%q) = %q, want %q", in, got, want)
		}
	}
}
