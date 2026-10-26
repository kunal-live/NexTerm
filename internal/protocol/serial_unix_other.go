//go:build !windows && !linux && !darwin

package protocol

import "os"

func configureSerialPort(f *os.File, baud, dataBits, stopBits int, parity string) error {
	return nil
}
