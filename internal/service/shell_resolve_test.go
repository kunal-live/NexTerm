package service

import (
	"runtime"
	"testing"
)

func TestResolveCustomShellRejectsUnsafe(t *testing.T) {
	for _, bad := range []string{"", "bash -c 'rm -rf ~'", "sh;reboot", "/bin/sh && id", "$(id)", "a|b", "no such shell xyz"} {
		if _, err := resolveCustomShell(bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
	if _, err := resolveCustomShell("definitely-not-installed-shell"); err == nil {
		t.Errorf("unknown program must be rejected")
	}
}

func TestResolveCustomShellAcceptsInstalled(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shells only")
	}
	got, err := resolveCustomShell("sh")
	if err != nil || got == "" {
		t.Fatalf("expected sh to resolve, got %q, %v", got, err)
	}
}
