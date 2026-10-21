package sshsession

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// setupMockHTTPConnectProxy starts an in-process HTTP CONNECT proxy server.
func setupMockHTTPConnectProxy(t *testing.T, expectedUser, expectedPass string) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen for http proxy: %v", err)
	}

	stopCh := make(chan struct{})

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-stopCh:
					return
				default:
					return
				}
			}

			go func(c net.Conn) {
				defer c.Close()
				br := bufio.NewReader(c)
				req, err := http.ReadRequest(br)
				if err != nil {
					return
				}

				if req.Method != http.MethodConnect {
					resp := http.Response{
						StatusCode: http.StatusMethodNotAllowed,
						ProtoMajor: 1,
						ProtoMinor: 1,
					}
					_ = resp.Write(c)
					return
				}

				if expectedUser != "" || expectedPass != "" {
					authHeader := req.Header.Get("Proxy-Authorization")
					expectedAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte(expectedUser+":"+expectedPass))
					if authHeader != expectedAuth {
						resp := http.Response{
							StatusCode: http.StatusProxyAuthRequired,
							ProtoMajor: 1,
							ProtoMinor: 1,
						}
						_ = resp.Write(c)
						return
					}
				}

				targetConn, err := net.DialTimeout("tcp", req.Host, 2*time.Second)
				if err != nil {
					resp := http.Response{
						StatusCode: http.StatusBadGateway,
						ProtoMajor: 1,
						ProtoMinor: 1,
					}
					_ = resp.Write(c)
					return
				}
				defer targetConn.Close()

				_, _ = io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n")

				errCh := make(chan error, 2)
				go func() {
					_, err := io.Copy(targetConn, c)
					errCh <- err
				}()
				go func() {
					_, err := io.Copy(c, targetConn)
					errCh <- err
				}()
				<-errCh
			}(conn)
		}
	}()

	return ln.Addr().String(), func() {
		close(stopCh)
		_ = ln.Close()
	}
}

// setupMockEchoTarget starts a simple echo TCP server.
func setupMockEchoTarget(t *testing.T) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen for echo target: %v", err)
	}

	stopCh := make(chan struct{})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-stopCh:
					return
				default:
					return
				}
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()

	return ln.Addr().String(), func() {
		close(stopCh)
		_ = ln.Close()
	}
}

func TestDialProxy_HTTPConnect(t *testing.T) {
	echoAddr, stopEcho := setupMockEchoTarget(t)
	defer stopEcho()

	proxyAddr, stopProxy := setupMockHTTPConnectProxy(t, "user1", "pass1")
	defer stopProxy()

	parts := strings.Split(proxyAddr, ":")
	proxyHost := parts[0]
	var proxyPort int
	_, _ = fmt.Sscanf(parts[1], "%d", &proxyPort)

	// Test 1: Successful CONNECT with valid authentication
	conn, err := DialProxy("http", proxyHost, proxyPort, "user1", "pass1", echoAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("expected successful HTTP CONNECT, got: %v", err)
	}
	defer conn.Close()

	testMsg := []byte("hello through http proxy\n")
	if _, err := conn.Write(testMsg); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	buf := make([]byte, len(testMsg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if string(buf) != string(testMsg) {
		t.Fatalf("expected '%s', got '%s'", testMsg, buf)
	}

	// Test 2: Authentication failure
	badConn, err := DialProxy("http", proxyHost, proxyPort, "user1", "wrongpass", echoAddr, 5*time.Second)
	if err == nil {
		badConn.Close()
		t.Fatalf("expected auth error, got nil")
	}
	if !strings.Contains(err.Error(), "407") {
		t.Fatalf("expected status 407 Proxy Authentication Required, got: %v", err)
	}
}

func TestDialProxy_Unsupported(t *testing.T) {
	_, err := DialProxy("invalid-proxy", "127.0.0.1", 1080, "", "", "127.0.0.1:22", 1*time.Second)
	if err == nil {
		t.Fatalf("expected error for unsupported proxy type")
	}
}

// setupMockSOCKS4Proxy starts an in-process SOCKS4 proxy.
func setupMockSOCKS4Proxy(t *testing.T) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen for socks4 proxy: %v", err)
	}

	stopCh := make(chan struct{})

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-stopCh:
					return
				default:
					return
				}
			}

			go func(c net.Conn) {
				defer c.Close()
				header := make([]byte, 8)
				if _, err := io.ReadFull(c, header); err != nil {
					return
				}
				// VN=4, CD=1
				if header[0] != 4 || header[1] != 1 {
					return
				}
				port := int(header[2])<<8 | int(header[3])
				ip := net.IP(header[4:8])

				// Read username until null byte
				b := make([]byte, 1)
				for {
					if _, err := c.Read(b); err != nil || b[0] == 0 {
						break
					}
				}

				targetAddr := fmt.Sprintf("%s:%d", ip.String(), port)
				targetConn, err := net.DialTimeout("tcp", targetAddr, 2*time.Second)
				if err != nil {
					_, _ = c.Write([]byte{0x00, 0x5b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
					return
				}
				defer targetConn.Close()

				// 0x5a = granted
				if _, err := c.Write([]byte{0x00, 0x5a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}); err != nil {
					return
				}

				errCh := make(chan error, 2)
				go func() {
					_, err := io.Copy(targetConn, c)
					errCh <- err
				}()
				go func() {
					_, err := io.Copy(c, targetConn)
					errCh <- err
				}()
				<-errCh
			}(conn)
		}
	}()

	return ln.Addr().String(), func() {
		close(stopCh)
		_ = ln.Close()
	}
}

func TestDialProxy_SOCKS4(t *testing.T) {
	echoAddr, stopEcho := setupMockEchoTarget(t)
	defer stopEcho()

	proxyAddr, stopProxy := setupMockSOCKS4Proxy(t)
	defer stopProxy()

	parts := strings.Split(proxyAddr, ":")
	proxyHost := parts[0]
	var proxyPort int
	_, _ = fmt.Sscanf(parts[1], "%d", &proxyPort)

	conn, err := DialProxy("socks4", proxyHost, proxyPort, "testuser", "", echoAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("expected successful SOCKS4 connection, got: %v", err)
	}
	defer conn.Close()

	testMsg := []byte("hello through socks4\n")
	if _, err := conn.Write(testMsg); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	buf := make([]byte, len(testMsg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if string(buf) != string(testMsg) {
		t.Fatalf("expected '%s', got '%s'", testMsg, buf)
	}
}
