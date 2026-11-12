//go:build !windows

package protocol

import "testing"

func TestResolveSerialPathOnlyAllowsDevNodes(t *testing.T) {
	for _, bad := range []string{"COM1", "/etc/passwd", "../etc/passwd", "/dev/../etc/shadow", "relative/tty", ""} {
		if _, err := resolveSerialPath(bad); err == nil {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
	if got, err := resolveSerialPath("/dev/ttyUSB0"); err != nil || got != "/dev/ttyUSB0" {
		t.Errorf("/dev/ttyUSB0 should be accepted, got %q, %v", got, err)
	}
}
