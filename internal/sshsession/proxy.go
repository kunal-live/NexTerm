package sshsession

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

type bufferedConn struct {
	net.Conn
	r io.Reader
}

func (c *bufferedConn) Read(b []byte) (int, error) {
	return c.r.Read(b)
}

func DialProxy(proxyType, proxyHost string, proxyPort int, username, password, targetAddr string, timeout time.Duration) (net.Conn, error) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	proxyType = strings.ToLower(strings.TrimSpace(proxyType))
	if proxyPort <= 0 {
		switch proxyType {
		case "http":
			proxyPort = 8080
		case "socks4", "socks5":
			proxyPort = 1080
		default:
			proxyPort = 1080
		}
	}
	proxyAddr := net.JoinHostPort(proxyHost, strconv.Itoa(proxyPort))

	switch proxyType {
	case "socks5":
		return dialSocks5(proxyAddr, username, password, targetAddr, timeout)
	case "socks4":
		return dialSocks4(proxyAddr, username, targetAddr, timeout)
	case "http":
		return dialHTTPConnect(proxyAddr, username, password, targetAddr, timeout)
	default:
		return nil, fmt.Errorf("unsupported proxy type '%s' (supported: socks5, socks4, http)", proxyType)
	}
}

func dialSocks5(proxyAddr, username, password, targetAddr string, timeout time.Duration) (net.Conn, error) {
	var auth *proxy.Auth
	if username != "" || password != "" {
		auth = &proxy.Auth{
			User:     username,
			Password: password,
		}
	}

	dialer, err := proxy.SOCKS5("tcp", proxyAddr, auth, &net.Dialer{Timeout: timeout})
	if err != nil {
		return nil, fmt.Errorf("socks5 dialer initialization failed: %w", err)
	}

	conn, err := dialer.Dial("tcp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("socks5 proxy failed to connect to %s via %s: %w", targetAddr, proxyAddr, err)
	}
	return conn, nil
}

func dialSocks4(proxyAddr, username, targetAddr string, timeout time.Duration) (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", proxyAddr, timeout)
	if err != nil {
		return nil, fmt.Errorf("failed to reach socks4 proxy %s: %w", proxyAddr, err)
	}

	host, portStr, err := net.SplitHostPort(targetAddr)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("invalid target address '%s': %w", targetAddr, err)
	}
	portInt, err := strconv.Atoi(portStr)
	if err != nil || portInt < 1 || portInt > 65535 {
		_ = conn.Close()
		return nil, fmt.Errorf("invalid port '%s' in target address", portStr)
	}

	_ = conn.SetDeadline(time.Now().Add(timeout))
	defer func() { _ = conn.SetDeadline(time.Time{}) }()

	ip := net.ParseIP(host)
	isIPv4 := ip != nil && ip.To4() != nil

	req := make([]byte, 0, 128)
	req = append(req, 0x04, 0x01) // SOCKS4 CONNECT

	portBytes := make([]byte, 2)
	binary.BigEndian.PutUint16(portBytes, uint16(portInt))
	req = append(req, portBytes...)

	if isIPv4 {
		req = append(req, ip.To4()...)
		req = append(req, []byte(username)...)
		req = append(req, 0x00)
	} else {
		req = append(req, 0x00, 0x00, 0x00, 0x01)
		req = append(req, []byte(username)...)
		req = append(req, 0x00)
		req = append(req, []byte(host)...)
		req = append(req, 0x00)
	}

	if _, err := conn.Write(req); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to send socks4 handshake: %w", err)
	}

	resp := make([]byte, 8)
	if _, err := io.ReadFull(conn, resp); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to read socks4 response: %w", err)
	}

	if resp[1] != 0x5a {
		_ = conn.Close()
		statusMsg := "request rejected or failed"
		switch resp[1] {
		case 0x5b:
			statusMsg = "request rejected or failed (91)"
		case 0x5c:
			statusMsg = "request rejected because SOCKS server cannot connect to identd on client (92)"
		case 0x5d:
			statusMsg = "request rejected because client program and identd report different user-ids (93)"
		}
		return nil, fmt.Errorf("socks4 proxy error: %s", statusMsg)
	}

	return conn, nil
}

func dialHTTPConnect(proxyAddr, username, password, targetAddr string, timeout time.Duration) (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", proxyAddr, timeout)
	if err != nil {
		return nil, fmt.Errorf("failed to reach http proxy %s: %w", proxyAddr, err)
	}

	_ = conn.SetDeadline(time.Now().Add(timeout))
	defer func() { _ = conn.SetDeadline(time.Time{}) }()

	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: NexTerm\r\nProxy-Connection: Keep-Alive\r\n", targetAddr, targetAddr)
	if username != "" || password != "" {
		creds := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		connectReq += fmt.Sprintf("Proxy-Authorization: Basic %s\r\n", creds)
	}
	connectReq += "\r\n"

	if _, err := io.WriteString(conn, connectReq); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to send http CONNECT header: %w", err)
	}

	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to read http proxy response: %w", err)
	}
	_ = resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("http proxy CONNECT refused with status: %s", resp.Status)
	}

	if reader.Buffered() > 0 {
		return &bufferedConn{Conn: conn, r: reader}, nil
	}
	return conn, nil
}

func dialEndpoint(targetAddr string, opts ConnectOptions, timeout time.Duration) (net.Conn, error) {
	if opts.ProxyType != "" && opts.ProxyType != "none" && opts.ProxyHost != "" {
		return DialProxy(
			opts.ProxyType,
			opts.ProxyHost,
			opts.ProxyPort,
			opts.ProxyUsername,
			opts.ProxyPassword,
			targetAddr,
			timeout,
		)
	}
	return net.DialTimeout("tcp", targetAddr, timeout)
}
