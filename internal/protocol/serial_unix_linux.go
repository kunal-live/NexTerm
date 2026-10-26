//go:build linux

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
	t, err := unix.IoctlGetTermios(int(f.Fd()), unix.TCGETS)
	if err != nil {
		return fmt.Errorf("read serial settings: %w", err)
	}
	t.Iflag = unix.IGNPAR
	t.Oflag = 0
	t.Lflag = 0
	t.Cflag = unix.CLOCAL | unix.CREAD | uint32(charSize)
	t.Cflag &^= unix.CSIZE | unix.PARENB | unix.PARODD | unix.CSTOPB | unix.CMSPAR
	t.Cflag |= uint32(charSize)
	switch strings.ToLower(parity) {
	case "odd":
		t.Cflag |= unix.PARENB | unix.PARODD
	case "even":
		t.Cflag |= unix.PARENB
	case "none", "":
	default:
		return fmt.Errorf("unsupported serial parity %q on Linux", parity)
	}
	if stopBits == 2 || (stopBits == 15 && dataBits == 5) {
		t.Cflag |= unix.CSTOPB
	}
	t.Ispeed = speed
	t.Ospeed = speed
	t.Cc[unix.VMIN] = 0
	t.Cc[unix.VTIME] = 1 // Return after a byte arrives or 100 ms elapses.
	if err := unix.IoctlSetTermios(int(f.Fd()), unix.TCSETS, t); err != nil {
		return fmt.Errorf("apply serial settings: %w", err)
	}
	return nil
}
