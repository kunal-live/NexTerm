//go:build windows

package protocol

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// DCB flag bits and setting values (winbase.h).
const (
	dcbBinary          = 0x00000001
	dcbParity          = 0x00000002
	dcbDtrControlOn    = 0x00000010
	dcbRtsControlOn    = 0x00001000
	serialNoParity     = 0
	serialOddParity    = 1
	serialEvenParity   = 2
	serialMarkParity   = 3
	serialSpaceParity  = 4
	serialOneStopBit   = 0
	serialOne5StopBits = 1
	serialTwoStopBits  = 2
)

// ListSerialPorts returns the COM ports registered under HKLM\HARDWARE\DEVICEMAP\SERIALCOMM.
func ListSerialPorts() []string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DEVICEMAP\SERIALCOMM`, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer key.Close()

	names, err := key.ReadValueNames(0)
	if err != nil {
		return nil
	}
	var ports []string
	for _, n := range names {
		if v, _, err := key.GetStringValue(n); err == nil && v != "" {
			ports = append(ports, v)
		}
	}
	sort.Slice(ports, func(i, j int) bool {
		ni, _ := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(ports[i]), "COM"))
		nj, _ := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(ports[j]), "COM"))
		if ni != nj {
			return ni < nj
		}
		return ports[i] < ports[j]
	})
	return ports
}

// configureSerialPort applies line settings and read timeouts to an open COM port.
// Without explicit timeouts ReadFile can block until the whole buffer fills, so
// incoming bytes would never reach the terminal.
func configureSerialPort(f *os.File, baud, dataBits, stopBits int, parity string) error {
	h := windows.Handle(f.Fd())

	var dcb windows.DCB
	dcb.DCBlength = uint32(unsafe.Sizeof(dcb))
	if err := windows.GetCommState(h, &dcb); err != nil {
		return fmt.Errorf("GetCommState: %w", err)
	}
	dcb.BaudRate = uint32(baud)
	dcb.ByteSize = uint8(dataBits)
	dcb.Flags = dcbBinary | dcbDtrControlOn | dcbRtsControlOn

	switch strings.ToLower(parity) {
	case "odd":
		dcb.Parity = serialOddParity
	case "even":
		dcb.Parity = serialEvenParity
	case "mark":
		dcb.Parity = serialMarkParity
	case "space":
		dcb.Parity = serialSpaceParity
	default:
		dcb.Parity = serialNoParity
	}
	if dcb.Parity != serialNoParity {
		dcb.Flags |= dcbParity
	}

	switch stopBits {
	case 2:
		dcb.StopBits = serialTwoStopBits
	case 15:
		dcb.StopBits = serialOne5StopBits
	default:
		dcb.StopBits = serialOneStopBit
	}

	if err := windows.SetCommState(h, &dcb); err != nil {
		return fmt.Errorf("SetCommState: %w", err)
	}

	// Return as soon as any byte arrives, or after 100 ms with nothing read.
	timeouts := windows.CommTimeouts{
		ReadIntervalTimeout:        0xFFFFFFFF,
		ReadTotalTimeoutMultiplier: 0xFFFFFFFF,
		ReadTotalTimeoutConstant:   100,
	}
	if err := windows.SetCommTimeouts(h, &timeouts); err != nil {
		return fmt.Errorf("SetCommTimeouts: %w", err)
	}
	return nil
}
