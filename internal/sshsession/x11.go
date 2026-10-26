package sshsession

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const x11AuthProto = "MIT-MAGIC-COOKIE-1"

// x11Request is the payload for an SSH "x11-req" channel request.
type x11Request struct {
	SingleConnection bool
	AuthProtocol     string
	AuthCookie       string
	ScreenNumber     uint32
}

var (
	localX11Mu     sync.Mutex
	localX11Cookie []byte
)

// LocalXAuthorityPath is where Nexterm keeps the cookie for the X server it launches.
func LocalXAuthorityPath() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "Nexterm", "x11", "Xauthority")
}

// PrepareLocalXAuthority creates a fresh MIT-MAGIC-COOKIE-1 for display and writes
// it to an Xauthority file (0600) that the local X server is started with via
// "-auth", so the server enforces access control instead of running with "-ac".
func PrepareLocalXAuthority(display int) (string, error) {
	cookie := make([]byte, 16)
	if _, err := rand.Read(cookie); err != nil {
		return "", err
	}

	p := LocalXAuthorityPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", fmt.Errorf("create xauthority dir: %w", err)
	}

	// Xauthority entry: family, address, display number, auth name, auth data —
	// each a big-endian uint16 length followed by the bytes. FamilyWild (0xFFFF)
	// matches any address.
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.BigEndian, uint16(0xFFFF))
	for _, field := range [][]byte{nil, []byte(strconv.Itoa(display)), []byte(x11AuthProto), cookie} {
		_ = binary.Write(&buf, binary.BigEndian, uint16(len(field)))
		buf.Write(field)
	}
	if err := os.WriteFile(p, buf.Bytes(), 0o600); err != nil {
		return "", fmt.Errorf("write xauthority: %w", err)
	}

	localX11Mu.Lock()
	localX11Cookie = cookie
	localX11Mu.Unlock()
	return p, nil
}

// localX11AuthCookie returns the real cookie for the local X server, if known:
// first the one Nexterm generated, then the Xauthority file from a previous run,
// then (off Windows) whatever `xauth` reports for the display.
func localX11AuthCookie(display int) []byte {
	localX11Mu.Lock()
	cookie := localX11Cookie
	localX11Mu.Unlock()
	if len(cookie) > 0 {
		return cookie
	}
	if data, err := os.ReadFile(LocalXAuthorityPath()); err == nil {
		if c := parseXAuthorityCookie(data, display); len(c) > 0 {
			return c
		}
	}
	if runtime.GOOS != "windows" {
		if out, err := exec.Command("xauth", "list", fmt.Sprintf(":%d", display)).Output(); err == nil {
			sc := bufio.NewScanner(bytes.NewReader(out))
			for sc.Scan() {
				fields := strings.Fields(sc.Text())
				if len(fields) == 3 && fields[1] == x11AuthProto {
					if c, err := hex.DecodeString(fields[2]); err == nil {
						return c
					}
				}
			}
		}
	}
	return nil
}

// parseXAuthorityCookie extracts the MIT-MAGIC-COOKIE-1 data for display from an Xauthority file.
func parseXAuthorityCookie(data []byte, display int) []byte {
	want := strconv.Itoa(display)
	r := bytes.NewReader(data)
	readField := func() ([]byte, bool) {
		var n uint16
		if err := binary.Read(r, binary.BigEndian, &n); err != nil {
			return nil, false
		}
		b := make([]byte, n)
		if _, err := io.ReadFull(r, b); err != nil {
			return nil, false
		}
		return b, true
	}
	for {
		var family uint16
		if err := binary.Read(r, binary.BigEndian, &family); err != nil {
			return nil
		}
		_, ok1 := readField()
		num, ok2 := readField()
		name, ok3 := readField()
		cookie, ok4 := readField()
		if !(ok1 && ok2 && ok3 && ok4) {
			return nil
		}
		if string(name) == x11AuthProto && string(num) == want {
			return cookie
		}
	}
}

// setupX11Forwarding asks the server to enable X11 forwarding on this session
// and then forwards any x11 channels the server opens back to the local X server
// (for example VcXsrv or Xming on Windows) listening on 127.0.0.1:(6000+display).
// The server is given a random fake cookie; each forwarded connection must
// present it and has it swapped for the real local cookie, as OpenSSH does.
// It is best-effort: it returns an error only if the initial request fails.
func setupX11Forwarding(session *ssh.Session, client *ssh.Client, display int) error {
	if session == nil || client == nil {
		return fmt.Errorf("nil session or client")
	}

	fakeCookie := make([]byte, 16)
	if _, err := rand.Read(fakeCookie); err != nil {
		return err
	}

	payload := x11Request{
		SingleConnection: false,
		AuthProtocol:     x11AuthProto,
		AuthCookie:       hex.EncodeToString(fakeCookie),
		ScreenNumber:     0,
	}

	ok, err := session.SendRequest("x11-req", true, ssh.Marshal(&payload))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("server rejected x11 forwarding request")
	}

	channels := client.HandleChannelOpen("x11")
	if channels == nil {
		return fmt.Errorf("x11 channels already being handled")
	}

	go func() {
		for newCh := range channels {
			ch, reqs, aerr := newCh.Accept()
			if aerr != nil {
				continue
			}
			go ssh.DiscardRequests(reqs)
			go forwardX11Channel(ch, display, fakeCookie)
		}
	}()

	return nil
}

// rewriteX11Setup reads the X11 connection setup from the remote client, checks
// that it carries fakeCookie, and returns the setup with realCookie substituted
// (or with no authorization when the local cookie is unknown).
func rewriteX11Setup(r io.Reader, fakeCookie, realCookie []byte) ([]byte, error) {
	hdr := make([]byte, 12)
	if _, err := io.ReadFull(r, hdr); err != nil {
		return nil, fmt.Errorf("read x11 setup: %w", err)
	}
	var order binary.ByteOrder
	switch hdr[0] {
	case 'B':
		order = binary.BigEndian
	case 'l':
		order = binary.LittleEndian
	default:
		return nil, fmt.Errorf("invalid x11 byte order 0x%02x", hdr[0])
	}
	nameLen := int(order.Uint16(hdr[6:8]))
	dataLen := int(order.Uint16(hdr[8:10]))
	pad := func(n int) int { return (4 - n%4) % 4 }

	body := make([]byte, nameLen+pad(nameLen)+dataLen+pad(dataLen))
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, fmt.Errorf("read x11 auth: %w", err)
	}
	name := body[:nameLen]
	data := body[nameLen+pad(nameLen) : nameLen+pad(nameLen)+dataLen]
	if string(name) != x11AuthProto || subtle.ConstantTimeCompare(data, fakeCookie) != 1 {
		return nil, errors.New("x11 connection presented an unknown auth cookie")
	}

	out := make([]byte, 12, 12+len(x11AuthProto)+pad(len(x11AuthProto))+len(realCookie)+pad(len(realCookie)))
	copy(out, hdr)
	if len(realCookie) == 0 {
		order.PutUint16(out[6:8], 0)
		order.PutUint16(out[8:10], 0)
		return out, nil
	}
	order.PutUint16(out[6:8], uint16(len(x11AuthProto)))
	order.PutUint16(out[8:10], uint16(len(realCookie)))
	out = append(out, x11AuthProto...)
	out = append(out, make([]byte, pad(len(x11AuthProto)))...)
	out = append(out, realCookie...)
	out = append(out, make([]byte, pad(len(realCookie)))...)
	return out, nil
}

// forwardX11Channel pipes a single incoming x11 channel to the local X server.
// On macOS/Linux the X server usually listens on a unix socket
// (/tmp/.X11-unix/X<display>); on Windows (and TCP-enabled X servers) it's
// TCP 127.0.0.1:(6000+display). Try the unix socket first off-Windows, then TCP.
func forwardX11Channel(ch ssh.Channel, display int, fakeCookie []byte) {
	if display < 0 {
		display = 0
	}

	setup, err := rewriteX11Setup(ch, fakeCookie, localX11AuthCookie(display))
	if err != nil {
		_ = ch.Close()
		return
	}

	var xconn net.Conn
	if runtime.GOOS != "windows" {
		xconn, err = net.DialTimeout("unix", fmt.Sprintf("/tmp/.X11-unix/X%d", display), 5*time.Second)
	}
	if xconn == nil {
		xconn, err = net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(6000+display)), 5*time.Second)
	}
	if err != nil || xconn == nil {
		_ = ch.Close()
		return
	}
	if _, err := xconn.Write(setup); err != nil {
		_ = xconn.Close()
		_ = ch.Close()
		return
	}

	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(ch, xconn); done <- struct{}{} }()
	go func() { _, _ = io.Copy(xconn, ch); done <- struct{}{} }()
	<-done

	_ = xconn.Close()
	_ = ch.Close()
}
