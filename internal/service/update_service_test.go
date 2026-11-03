package service

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
			{
				Name:               "Nexterm-macos-arm64.zip",
				Size:               22000000,
				BrowserDownloadURL: "https://example.com/Nexterm-macos-arm64.zip",
			},
			{
				Name:               "Nexterm-linux-x64.tar.gz",
				Size:               19000000,
				BrowserDownloadURL: "https://example.com/Nexterm-linux-x64.tar.gz",
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
	if info.DownloadURL == "" {
		t.Errorf("expected DownloadURL to be populated for %s, got empty", info.AssetName)
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

func TestValidateUpdateURL(t *testing.T) {
	ok := []string{
		"https://github.com/kunal-live/NexTerm/releases/download/v1.4.1/nexterm.exe",
		"https://objects.githubusercontent.com/github-production-release-asset/x",
	}
	bad := []string{
		"http://github.com/kunal-live/NexTerm/releases/download/v1.4.1/nexterm.exe",
		"https://example.com/nexterm.exe",
		"https://github.com.evil.example/nexterm.exe",
		"file:///C:/Windows/System32/calc.exe",
	}
	for _, u := range ok {
		if err := validateUpdateURL(u); err != nil {
			t.Errorf("validateUpdateURL(%q) = %v, want nil", u, err)
		}
	}
	for _, u := range bad {
		if err := validateUpdateURL(u); err == nil {
			t.Errorf("validateUpdateURL(%q) = nil, want error", u)
		}
	}
}

func TestParseChecksumManifest(t *testing.T) {
	manifest := "" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  NexTerm-Setup.exe\n" +
		"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB *nexterm.exe\n" +
		"not-a-digest  broken.zip\n"

	if sum, ok := parseChecksumManifest(strings.NewReader(manifest), "nexterm.exe"); !ok || sum != strings.Repeat("b", 64) {
		t.Errorf("expected lower-cased digest for nexterm.exe, got %q (ok=%v)", sum, ok)
	}
	if _, ok := parseChecksumManifest(strings.NewReader(manifest), "broken.zip"); ok {
		t.Errorf("malformed digest must not be accepted")
	}
	if _, ok := parseChecksumManifest(strings.NewReader(manifest), "missing.exe"); ok {
		t.Errorf("missing asset must not be found")
	}
}

func TestApplyUpdateRejectsUnofferedURL(t *testing.T) {
	svc := NewUpdateService(nil)
	err := svc.DownloadAndApplyUpdate(context.Background(), "https://github.com/attacker/repo/releases/download/v9/nexterm.exe")
	if err == nil {
		t.Fatal("expected ApplyUpdate to reject a URL that no update check offered")
	}
}

func TestFindMacAppBundle(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/Applications/NexTerm.app/Contents/MacOS/NexTerm", "/Applications/NexTerm.app"},
		{"/Users/kunal/Downloads/nexterm.app/Contents/MacOS/nexterm", "/Users/kunal/Downloads/nexterm.app"},
		{"/usr/local/bin/nexterm", ""},
		{"C:\\Program Files\\Nexterm\\nexterm.exe", ""},
	}

	for _, tt := range tests {
		actual := findMacAppBundle(tt.input)
		if filepath.ToSlash(actual) != filepath.ToSlash(tt.expected) {
			t.Errorf("findMacAppBundle(%q) = %q; want %q", tt.input, actual, tt.expected)
		}
	}
}

func TestExtractZipToDir(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "zip_dir_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	zipPath := filepath.Join(tempDir, "archive.zip")
	destDir := filepath.Join(tempDir, "out")

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	f, err := w.Create("nested/file.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write([]byte("HELLO_ZIP_CONTENT"))
	_ = w.Close()

	if err := os.WriteFile(zipPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	if err := extractZipToDir(zipPath, destDir); err != nil {
		t.Fatalf("extractZipToDir failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(destDir, "nested", "file.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "HELLO_ZIP_CONTENT" {
		t.Errorf("unexpected content: %s", string(content))
	}
}

func TestExtractTarGz(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "targz_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	tarGzPath := filepath.Join(tempDir, "archive.tar.gz")
	destDir := filepath.Join(tempDir, "out")

	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	body := []byte("HELLO_TAR_GZ")
	hdr := &tar.Header{
		Name: "nexterm",
		Mode: 0755,
		Size: int64(len(body)),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	_ = tw.Close()
	_ = gw.Close()

	if err := os.WriteFile(tarGzPath, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	if err := extractTarGz(tarGzPath, destDir); err != nil {
		t.Fatalf("extractTarGz failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(destDir, "nexterm"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "HELLO_TAR_GZ" {
		t.Errorf("unexpected content: %s", string(content))
	}
}
