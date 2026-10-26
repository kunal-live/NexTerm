package tunnel

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"
)

// SOCKS5 constants (RFC 1928).
const (
	socks5Version      = 0x05
	socks5NoAuth       = 0x00
	socks5NoAcceptable = 0xFF
	socks5CmdConnect   = 0x01
	socks5AtypIPv4     = 0x01
	socks5AtypDomain   = 0x03
	socks5AtypIPv6     = 0x04

	socks5Succeeded        = 0x00
	socks5GeneralFailure   = 0x01
	socks5CmdNotSupported  = 0x07
	socks5AddrNotSupported = 0x08
	socks5HandshakeTimeout = 30 * time.Second
)

// readSocks5Request performs the SOCKS5 greeting (no authentication) and reads a
// CONNECT request from c, returning the requested "host:port" target.
func readSocks5Request(c net.Conn) (string, error) {
	_ = c.SetDeadline(time.Now().Add(socks5HandshakeTimeout))
	defer func() { _ = c.SetDeadline(time.Time{}) }()

	hdr := make([]byte, 2)
	if _, err := io.ReadFull(c, hdr); err != nil {
		return "", err
	}
	if hdr[0] != socks5Version {
		return "", fmt.Errorf("unsupported SOCKS version %d", hdr[0])
	}
	methods := make([]byte, int(hdr[1]))
	if _, err := io.ReadFull(c, methods); err != nil {
		return "", err
	}
	noAuth := false
	for _, m := range methods {
		if m == socks5NoAuth {
			noAuth = true
			break
		}
	}
	if !noAuth {
		_, _ = c.Write([]byte{socks5Version, socks5NoAcceptable})
		return "", errors.New("SOCKS client offered no supported auth method")
	}
	if _, err := c.Write([]byte{socks5Version, socks5NoAuth}); err != nil {
		return "", err
	}

	req := make([]byte, 4)
	if _, err := io.ReadFull(c, req); err != nil {
		return "", err
	}
	if req[0] != socks5Version {
		return "", fmt.Errorf("unsupported SOCKS version %d", req[0])
	}
	if req[1] != socks5CmdConnect {
		writeSocks5Reply(c, socks5CmdNotSupported)
		return "", fmt.Errorf("unsupported SOCKS command %d", req[1])
	}

	var host string
	switch req[3] {
	case socks5AtypIPv4:
		ip := make([]byte, net.IPv4len)
		if _, err := io.ReadFull(c, ip); err != nil {
			return "", err
		}
		host = net.IP(ip).String()
	case socks5AtypIPv6:
		ip := make([]byte, net.IPv6len)
		if _, err := io.ReadFull(c, ip); err != nil {
			return "", err
		}
		host = net.IP(ip).String()
	case socks5AtypDomain:
		l := make([]byte, 1)
		if _, err := io.ReadFull(c, l); err != nil {
			return "", err
		}
		name := make([]byte, int(l[0]))
		if _, err := io.ReadFull(c, name); err != nil {
			return "", err
		}
		host = string(name)
	default:
		writeSocks5Reply(c, socks5AddrNotSupported)
		return "", fmt.Errorf("unsupported SOCKS address type %d", req[3])
	}

	portBuf := make([]byte, 2)
	if _, err := io.ReadFull(c, portBuf); err != nil {
		return "", err
	}
	port := binary.BigEndian.Uint16(portBuf)
	return net.JoinHostPort(host, strconv.Itoa(int(port))), nil
}

// writeSocks5Reply sends a reply with an all-zero IPv4 bind address.
func writeSocks5Reply(c net.Conn, status byte) {
	_, _ = c.Write([]byte{socks5Version, status, 0x00, socks5AtypIPv4, 0, 0, 0, 0, 0, 0})
}
