package sftpmanager

import (
	"path/filepath"
	"testing"
)

func TestIsWithinBase(t *testing.T) {
	tests := []struct {
		base     string
		target   string
		expected bool
	}{
		{
			base:     filepath.Join("C:", "Users", "test", "downloads"),
			target:   filepath.Join("C:", "Users", "test", "downloads", "folder", "file.txt"),
			expected: true,
		},
		{
			base:     filepath.Join("C:", "Users", "test", "downloads"),
			target:   filepath.Join("C:", "Users", "test", "downloads"),
			expected: true,
		},
		{
			base:     filepath.Join("C:", "Users", "test", "downloads"),
			target:   filepath.Join("C:", "Users", "test", "documents", "evil.txt"),
			expected: false,
		},
		{
			base:     filepath.Join("C:", "Users", "test", "downloads"),
			target:   filepath.Join("C:", "Users", "test", "downloads_other", "file.txt"),
			expected: false, // Ensure prefix match requires directory separator
		},
		{
			base:     filepath.Join("C:", "Users", "test", "downloads"),
			target:   filepath.Join("C:", "Windows", "System32", "calc.exe"),
			expected: false,
		},
	}

	for _, tt := range tests {
		actual := isWithinBase(tt.base, tt.target)
		if actual != tt.expected {
			t.Errorf("isWithinBase(%q, %q) = %v, want %v", tt.base, tt.target, actual, tt.expected)
		}
	}
}

