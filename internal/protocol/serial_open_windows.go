//go:build windows

package protocol

import (
	"os"
	"strings"
)

const serialOpenFlags = os.O_RDWR

func defaultSerialPort() string { return "COM1" }

// resolveSerialPath applies the \\.\ prefix Windows needs for COM ports above COM9.
func resolveSerialPath(port string) (string, error) {
	port = strings.TrimSpace(port)
	if !strings.HasPrefix(port, `\\.\`) {
		port = `\\.\` + port
	}
	return port, nil
}
