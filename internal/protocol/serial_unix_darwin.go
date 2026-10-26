//go:build darwin

package protocol

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

func configureSerialPort(f *os.File, baud, dataBits, stopBits int, parity string) error {
	speed, err := unixSerialBaud(baud)
	if err != nil {
		return err
	}
	charSize, err := unixSerialCharacterSize(dataBits)
	if err != nil {
		return err
	}
	t, err := unix.IoctlGetTermios(int(f.Fd()), unix.TIOCGETA)
	if err != nil {
		return fmt.Errorf("read serial settings: %w", err)
	}
	t.Iflag = unix.IGNPAR
	t.Oflag = 0
	t.Lflag = 0
	t.Cflag = unix.CLOCAL | unix.CREAD | charSize
	t.Cflag &^= unix.CSIZE | unix.PARENB | unix.PARODD | unix.CSTOPB
	t.Cflag |= charSize
	switch strings.ToLower(parity) {
	case "odd":
		t.Cflag |= unix.PARENB | unix.PARODD
	case "even":
		t.Cflag |= unix.PARENB
	case "none", "":
	default:
		return fmt.Errorf("unsupported serial parity %q on macOS", parity)
	}
	if stopBits == 2 || (stopBits == 15 && dataBits == 5) {
		t.Cflag |= unix.CSTOPB
	}
	t.Ispeed = uint64(speed)
	t.Ospeed = uint64(speed)
	t.Cc[unix.VMIN] = 0
	t.Cc[unix.VTIME] = 1 // Return after a byte arrives or 100 ms elapses.
	if err := unix.IoctlSetTermios(int(f.Fd()), unix.TIOCSETA, t); err != nil {
		return fmt.Errorf("apply serial settings: %w", err)
	}
	return nil
}
