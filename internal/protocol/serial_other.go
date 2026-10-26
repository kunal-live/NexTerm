//go:build !windows

package protocol

import (
	"path/filepath"
	"sort"
)

// ListSerialPorts returns serial device nodes found under /dev.
func ListSerialPorts() []string {
	patterns := []string{"/dev/ttyS*", "/dev/ttyUSB*", "/dev/ttyACM*", "/dev/ttyAMA*", "/dev/cu.*"}
	var ports []string
	for _, p := range patterns {
		matches, _ := filepath.Glob(p)
		ports = append(ports, matches...)
	}
	sort.Strings(ports)
	return ports
}
