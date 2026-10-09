package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		v1       string
		v2       string
		expected int
	}{
		{"1.3.1", "1.3.0", 1},
		{"v1.3.1", "1.3.0", 1},
		{"v1.4.0", "v1.3.9", 1},
		{"2.0.0", "1.99.99", 1},
		{"1.3.0", "1.3.0", 0},
		{"v1.3.0", "1.3.0", 0},
		{"1.2.9", "1.3.0", -1},
		{"1.3.0", "1.3.1", -1},
		{"1.3.0-beta", "1.3.0", 0},
	}

	for _, tt := range tests {
		actual := CompareVersions(tt.v1, tt.v2)
		if actual != tt.expected {
			t.Errorf("CompareVersions(%q, %q) = %d; want %d", tt.v1, tt.v2, actual, tt.expected)
		}
	}
}

func TestCheckForUpdatesWithMockServer(t *testing.T) {
	mockRelease := githubRelease{
		TagName:     "v1.3.1",
		Name:        "Nexterm v1.3.1 - Performance & Security Fixes",
		Body:        "- Fixed terminal reconnect delay\n- Locked Dark Mode updates\n- Added Auto-Update feature",
		PublishedAt: "2026-10-09T10:00:00Z",
		HTMLURL:     "https://github.com/kunal-live/NexTerm/releases/tag/v1.3.1",
		Assets: []githubReleaseAsset{
			{
				Name:               "NexTerm.exe",
				Size:               20000000,
				BrowserDownloadURL: "https://example.com/NexTerm.exe",
			},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mockRelease)
	}))
	defer server.Close()

	svc := NewUpdateService(nil)
	svc.SetCurrentVersion("1.3.0")
	svc.SetCustomEndpoint(server.URL)

	info, err := svc.CheckForUpdates(context.Background())
	if err != nil {
		t.Fatalf("CheckForUpdates failed: %v", err)
	}

	if !info.HasUpdate {
		t.Errorf("expected HasUpdate = true, got false")
	}
	if info.LatestVersion != "v1.3.1" {
		t.Errorf("expected LatestVersion 'v1.3.1', got %q", info.LatestVersion)
	}
	if info.DownloadURL != "https://example.com/NexTerm.exe" {
		t.Errorf("expected DownloadURL 'https://example.com/NexTerm.exe', got %q", info.DownloadURL)
	}
}

func TestExtractExeFromZip(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "zip_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	zipPath := filepath.Join(tempDir, "test.zip")
	destExe := filepath.Join(tempDir, "extracted.exe")

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	f, err := w.Create("NexTerm.exe")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write([]byte("MZ_MOCK_BINARY_DATA"))
	_ = w.Close()

	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	if err := extractExeFromZip(zipPath, destExe); err != nil {
		t.Fatalf("extractExeFromZip failed: %v", err)
	}

	content, err := os.ReadFile(destExe)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "MZ_MOCK_BINARY_DATA" {
		t.Errorf("unexpected content: %s", string(content))
	}
}
