//go:build linux || darwin

package protocol

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func unixSerialBaud(baud int) (uint32, error) {
	values := map[int]uint32{
		50: unix.B50, 75: unix.B75, 110: unix.B110, 134: unix.B134,
		150: unix.B150, 200: unix.B200, 300: unix.B300, 600: unix.B600,
		1200: unix.B1200, 1800: unix.B1800, 2400: unix.B2400, 4800: unix.B4800,
		9600: unix.B9600, 19200: unix.B19200, 38400: unix.B38400,
		57600: unix.B57600, 115200: unix.B115200, 230400: unix.B230400,
	}
	value, ok := values[baud]
	if !ok {
		return 0, fmt.Errorf("unsupported serial baud rate %d", baud)
	}
	return value, nil
}

func unixSerialCharacterSize(dataBits int) (uint64, error) {
	switch dataBits {
	case 5:
		return unix.CS5, nil
	case 6:
		return unix.CS6, nil
	case 7:
		return unix.CS7, nil
	case 8:
		return unix.CS8, nil
	default:
		return 0, fmt.Errorf("unsupported serial data bits %d", dataBits)
	}
}
