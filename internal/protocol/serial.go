package protocol

import (
	"context"
	"fmt"
	"io"
	"nexterm/internal/model"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

// SerialSession implements ProtocolSession for COM / Serial port hardware communication.
type SerialSession struct {
	*BaseSession
	portName  string
	baudRate  int
	dataBits  int
	stopBits  int
	parity    string
	file      *os.File
	stopChan  chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
}

// NewSerialSession constructs a new Serial protocol session.
func NewSerialSession(id string, profile model.SessionProfile) *SerialSession {
	base := NewBaseSession(id, "serial", profile)
	port := profile.SerialPort
	if port == "" {
		port = "COM1"
	}
	baud := profile.BaudRate
	if baud <= 0 {
		baud = 115200
	}
	dataBits := profile.DataBits
	if dataBits <= 0 {
		dataBits = 8
	}
	stopBits := profile.StopBits
	if stopBits <= 0 {
		stopBits = 1
	}
	parity := profile.Parity
	if parity == "" {
		parity = "none"
	}

	return &SerialSession{
		BaseSession: base,
		portName:    port,
		baudRate:    baud,
		dataBits:    dataBits,
		stopBits:    stopBits,
		parity:      parity,
		stopChan:    make(chan struct{}),
	}
}

// Connect opens the serial COM port on the host operating system.
func (s *SerialSession) Connect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	targetPort := s.portName
	// Windows COM port device naming requires \\.\ prefix; macOS/Linux use /dev/tty* or /dev/cu*
	if runtime.GOOS == "windows" && !strings.HasPrefix(targetPort, `\\.\`) {
		targetPort = `\\.\` + targetPort
	}

	s.EmitStateChange("connecting", fmt.Sprintf("Opening serial port %s at %d baud...", s.portName, s.baudRate))

	f, err := os.OpenFile(targetPort, os.O_RDWR, 0)
	if err != nil {
		s.SetConnected(false)
		s.EmitStateChange("failed", err.Error())
		return fmt.Errorf("open serial port %s failed: %w", s.portName, err)
	}

	if err := configureSerialPort(f, s.baudRate, s.dataBits, s.stopBits, s.parity); err != nil {
		_ = f.Close()
		s.SetConnected(false)
		s.EmitStateChange("failed", err.Error())
		return fmt.Errorf("configure serial port %s failed: %w", s.portName, err)
	}

	s.file = f
	s.SetConnected(true)
	s.EmitStateChange("connected", fmt.Sprintf("Serial %s connected (%d baud)", s.portName, s.baudRate))

	// Header banner to inform user
	banner := fmt.Sprintf("\r\n--- Connected to Serial Port: %s (%d, %d, %s, %d) ---\r\n\r\n",
		s.portName, s.baudRate, s.dataBits, s.parity, s.stopBits)
	s.EmitData([]byte(banner))

	go s.readLoop(f)

	return nil
}

func (s *SerialSession) readLoop(f *os.File) {
	buf := make([]byte, 1024)

	for {
		select {
		case <-s.stopChan:
			return
		default:
		}

		n, err := f.Read(buf)
		if err == io.EOF {
			// A serial line has no end-of-file: a read timeout with no bytes is
			// reported as EOF, so just poll again.
			err = nil
		}
		if err != nil {
			select {
			case <-s.stopChan:
				// Closed locally via Disconnect; not a hardware disconnect.
				return
			default:
			}
			s.SetConnected(false)
			s.EmitDisconnect("Serial port disconnected or closed", err)
			_ = s.Disconnect()
			return
		}

		if n > 0 {
			s.EmitData(buf[:n])
		} else {
			// Small sleep if no bytes to prevent tight CPU looping
			time.Sleep(10 * time.Millisecond)
		}
	}
}

// Disconnect closes the COM port device handle.
func (s *SerialSession) Disconnect() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.closeOnce.Do(func() {
		close(s.stopChan)
		s.SetConnected(false)
		if s.file != nil {
			_ = s.file.Close()
			s.file = nil
		}
	})
	return nil
}

// Write sends input bytes directly over the serial line.
func (s *SerialSession) Write(data []byte) error {
	s.mu.Lock()
	f := s.file
	s.mu.Unlock()

	if f == nil {
		return fmt.Errorf("serial port is not open")
	}
	_, err := f.Write(data)
	return err
}

// Resize is a no-op for serial hardware connections.
func (s *SerialSession) Resize(cols, rows int) error {
	return nil
}
