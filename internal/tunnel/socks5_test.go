package tunnel

import (
	"net"
	"testing"
)

func TestReadSocks5Request(t *testing.T) {
	cases := []struct {
		name    string
		request []byte
		want    string
	}{
		{"domain", append(append([]byte{5, 1, 0, 3, 11}, "example.com"...), 0x01, 0xBB), "example.com:443"},
		{"ipv4", []byte{5, 1, 0, 1, 10, 0, 0, 5, 0x05, 0xF1}, "10.0.0.5:1521"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			client, server := net.Pipe()
			defer client.Close()
			defer server.Close()

			go func() {
				_, _ = client.Write([]byte{5, 1, 0}) // greeting: one method, no-auth
				reply := make([]byte, 2)
				_, _ = client.Read(reply)
				_, _ = client.Write(c.request)
			}()

			got, err := readSocks5Request(server)
			if err != nil {
				t.Fatalf("readSocks5Request: %v", err)
			}
			if got != c.want {
				t.Fatalf("target = %q, want %q", got, c.want)
			}
		})
	}
}
