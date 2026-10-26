package sshsession

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// x11Setup builds a little-endian X11 connection setup with the given auth.
func x11Setup(name string, data []byte) []byte {
	pad := func(n int) int { return (4 - n%4) % 4 }
	b := []byte{'l', 0, 11, 0, 0, 0}
	b = binary.LittleEndian.AppendUint16(b, uint16(len(name)))
	b = binary.LittleEndian.AppendUint16(b, uint16(len(data)))
	b = append(b, 0, 0)
	b = append(b, name...)
	b = append(b, make([]byte, pad(len(name)))...)
	b = append(b, data...)
	b = append(b, make([]byte, pad(len(data)))...)
	return b
}

func TestRewriteX11Setup(t *testing.T) {
	fake := bytes.Repeat([]byte{0xAA}, 16)
	realCookie := bytes.Repeat([]byte{0x55}, 16)

	got, err := rewriteX11Setup(bytes.NewReader(x11Setup(x11AuthProto, fake)), fake, realCookie)
	if err != nil {
		t.Fatalf("rewriteX11Setup: %v", err)
	}
	if want := x11Setup(x11AuthProto, realCookie); !bytes.Equal(got, want) {
		t.Fatalf("fake cookie was not replaced:\n got %x\nwant %x", got, want)
	}

	got, err = rewriteX11Setup(bytes.NewReader(x11Setup(x11AuthProto, fake)), fake, nil)
	if err != nil {
		t.Fatalf("rewriteX11Setup without local cookie: %v", err)
	}
	if want := x11Setup("", nil); !bytes.Equal(got, want) {
		t.Fatalf("expected auth to be stripped:\n got %x\nwant %x", got, want)
	}

	if _, err := rewriteX11Setup(bytes.NewReader(x11Setup(x11AuthProto, realCookie)), fake, realCookie); err == nil {
		t.Fatal("a connection presenting the wrong cookie must be rejected")
	}
}

func TestParseXAuthorityCookie(t *testing.T) {
	var buf bytes.Buffer
	write := func(display string, cookie []byte) {
		_ = binary.Write(&buf, binary.BigEndian, uint16(0xFFFF))
		for _, f := range [][]byte{nil, []byte(display), []byte(x11AuthProto), cookie} {
			_ = binary.Write(&buf, binary.BigEndian, uint16(len(f)))
			buf.Write(f)
		}
	}
	write("0", []byte("cookie-zero-0000"))
	write("1", []byte("cookie-one-11111"))

	if got := parseXAuthorityCookie(buf.Bytes(), 1); string(got) != "cookie-one-11111" {
		t.Fatalf("display 1 cookie = %q", got)
	}
	if got := parseXAuthorityCookie(buf.Bytes(), 7); got != nil {
		t.Fatalf("expected no cookie for display 7, got %q", got)
	}
}
