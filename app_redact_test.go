package main

import "testing"

func TestRedactLogData(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"mkdir -p /tmp/x", "mkdir -p /tmp/x"},
		{"ssh -p 2222 user@host", "ssh -p 2222 user@host"},
		{"ssh -p2222 user@host", "ssh -p2222 user@host"},
		{"docker run -p 80:80 nginx", "docker run -p 80:80 nginx"},
		{"cd my-project", "cd my-project"},
		{"Changing password for user kunal.", "Changing password for user kunal."},
		{"mysql -u root -pS3cret db", "mysql -u root -p[REDACTED] db"},
		{"DB_PASSWORD=hunter2", "DB_PASSWORD=[REDACTED]"},
		{"token: abc123", "token: [REDACTED]"},
		{"curl -H 'Authorization: Bearer eyJabc'", "curl -H 'Authorization: Bearer [REDACTED]"},
		{"tool --password hunter2", "tool --password [REDACTED]"},
	}
	for _, c := range cases {
		if got := redactLogData(c.in); got != c.want {
			t.Errorf("redactLogData(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
