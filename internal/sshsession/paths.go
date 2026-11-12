package sshsession

import (
	"os"
	"path/filepath"
	"strings"
)

// ExpandUserPath expands a leading "~" (as in "~/.ssh/id_ed25519") to the user's
// home directory. Shells expand it before a program ever sees it, so paths typed
// into the session dialog or imported from an OpenSSH-style config routinely
// contain it on macOS and Linux, where os.ReadFile would otherwise fail.
func ExpandUserPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}
