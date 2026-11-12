//go:build !windows

package protocol

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// serialOpenFlags opens the device read/write without letting it become the
// process's controlling terminal (a hang-up on the serial line would otherwise
// deliver SIGHUP to the whole app).
const serialOpenFlags = os.O_RDWR | syscall.O_NOCTTY

// defaultSerialPort is used when a profile does not name a port.
func defaultSerialPort() string {
	if ports := ListSerialPorts(); len(ports) > 0 {
		return ports[0]
	}
	return "/dev/ttyUSB0"
}

// resolveSerialPath restricts serial sessions to device nodes under /dev, so an
// imported or hand-edited profile cannot make the app open (and write to) an
// arbitrary file such as ~/.ssh/authorized_keys.
func resolveSerialPath(port string) (string, error) {
	port = strings.TrimSpace(port)
	if !strings.HasPrefix(port, "/dev/") {
		return "", fmt.Errorf("serial port %q is not a device under /dev", port)
	}
	clean := filepath.Clean(port)
	if !strings.HasPrefix(clean, "/dev/") {
		return "", fmt.Errorf("serial port %q is not a device under /dev", port)
	}
	if fi, err := os.Stat(clean); err == nil && fi.Mode()&os.ModeCharDevice == 0 {
		return "", fmt.Errorf("%s is not a character device", clean)
	}
	return clean, nil
}
