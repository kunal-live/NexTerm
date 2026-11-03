package service

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CurrentAppVersion defines the running application version.
const CurrentAppVersion = "1.4.2"

// DefaultUpdateRepo is the GitHub repository queried for updates.
const DefaultUpdateRepo = "kunal-live/NexTerm"

// maxUpdatePayloadBytes caps the size of a downloaded or extracted update binary.
const maxUpdatePayloadBytes = 512 << 20

// checksumAssetNames are the release assets searched for SHA-256 digests, in order.
var checksumAssetNames = []string{"sha256sums", "sha256sums.txt", "checksums.txt"}

// UpdateInfo holds details about an available update.
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
	ReleaseName    string `json:"releaseName"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
	DownloadURL    string `json:"downloadURL"`
	AssetSize      int64  `json:"assetSize"`
	AssetName      string `json:"assetName"`
	HTMLURL        string `json:"htmlURL"`
}

// githubReleaseAsset represents a file attached to a GitHub release.
type githubReleaseAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// githubRelease represents GitHub's release API payload.
type githubRelease struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	PublishedAt string               `json:"published_at"`
	HTMLURL     string               `json:"html_url"`
	Assets      []githubReleaseAsset `json:"assets"`
}

// pendingUpdate remembers the asset offered by the last successful update check,
// so ApplyUpdate only ever downloads a URL the backend itself selected.
type pendingUpdate struct {
	downloadURL string
	assetName   string
	checksumURL string
}

// UpdateService manages checking, downloading, and applying in-app updates.
type UpdateService struct {
	mu             sync.Mutex
	client         *http.Client
	repo           string
	customEndpoint string
	currentVersion string
	emitter        EventEmitter
	pending        *pendingUpdate
}

// NewUpdateService creates an UpdateService instance.
func NewUpdateService(emitter EventEmitter) *UpdateService {
	return &UpdateService{
		client: &http.Client{
			Timeout:       5 * time.Minute,
			CheckRedirect: checkUpdateRedirect,
		},
		repo:           DefaultUpdateRepo,
		currentVersion: CurrentAppVersion,
		emitter:        emitter,
	}
}

// SetCurrentVersion overrides the version for testing.
func (s *UpdateService) SetCurrentVersion(v string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentVersion = v
}

// CurrentVersion returns the running application version string.
func (s *UpdateService) CurrentVersion() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentVersion
}

// SetCustomEndpoint allows mocking or pointing to a custom update API.
func (s *UpdateService) SetCustomEndpoint(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.customEndpoint = url
}

// CheckForUpdates queries the release source and reports if a newer version is available.
func (s *UpdateService) CheckForUpdates(ctx context.Context) (*UpdateInfo, error) {
	s.mu.Lock()
	endpoint := s.customEndpoint
	repo := s.repo
	curVer := s.currentVersion
	s.mu.Unlock()

	if endpoint == "" {
		endpoint = fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create update request failed: %w", err)
	}
	req.Header.Set("User-Agent", "NexTerm-Desktop/"+curVer)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("check updates request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return &UpdateInfo{
			CurrentVersion: curVer,
			LatestVersion:  curVer,
			HasUpdate:      false,
			ReleaseNotes:   "No releases found for repository.",
		}, nil
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("update server returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var rel githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release metadata failed: %w", err)
	}

	cleanLatest := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	cleanCurrent := strings.TrimPrefix(strings.TrimSpace(curVer), "v")

	hasUpdate := CompareVersions(cleanLatest, cleanCurrent) > 0

	// Select the best asset for the platform
	var selectedAsset *githubReleaseAsset
	for _, asset := range rel.Assets {
		lower := strings.ToLower(asset.Name)
		switch runtime.GOOS {
		case "windows":
			// Prioritize direct portable executable, then portable zip, then setup exe
			if lower == "nexterm.exe" {
				selectedAsset = &asset
				break
			}
			if (strings.Contains(lower, "portable") || strings.Contains(lower, "windows")) && strings.HasSuffix(lower, ".zip") {
				selectedAsset = &asset
			} else if selectedAsset == nil && (strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".exe")) {
				selectedAsset = &asset
			}
		case "darwin":
			// macOS Apple Silicon (arm64) or universal archive
			if (strings.Contains(lower, "macos") || strings.Contains(lower, "darwin") || strings.Contains(lower, "mac")) && strings.HasSuffix(lower, ".zip") {
				selectedAsset = &asset
				break
			}
		case "linux":
			// Linux x86_64 tarball
			if strings.Contains(lower, "linux") && (strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".zip")) {
				selectedAsset = &asset
				break
			}
		}
	}

	info := &UpdateInfo{
		CurrentVersion: curVer,
		LatestVersion:  rel.TagName,
		HasUpdate:      hasUpdate,
		ReleaseName:    rel.Name,
		ReleaseNotes:   rel.Body,
		PublishedAt:    rel.PublishedAt,
		HTMLURL:        rel.HTMLURL,
	}

	var pending *pendingUpdate
	if selectedAsset != nil {
		info.DownloadURL = selectedAsset.BrowserDownloadURL
		info.AssetName = selectedAsset.Name
		info.AssetSize = selectedAsset.Size

		pending = &pendingUpdate{
			downloadURL: selectedAsset.BrowserDownloadURL,
			assetName:   selectedAsset.Name,
			checksumURL: findChecksumAssetURL(rel.Assets),
		}
	}

	s.mu.Lock()
	s.pending = pending
	s.mu.Unlock()

	return info, nil
}

// findChecksumAssetURL returns the download URL of the release's SHA-256 manifest, if any.
func findChecksumAssetURL(assets []githubReleaseAsset) string {
	for _, want := range checksumAssetNames {
		for _, a := range assets {
			if strings.ToLower(a.Name) == want {
				return a.BrowserDownloadURL
			}
		}
	}
	return ""
}

// CompareVersions returns 1 if v1 > v2, -1 if v1 < v2, and 0 if v1 == v2.
func CompareVersions(v1, v2 string) int {
	v1 = strings.TrimPrefix(strings.TrimSpace(v1), "v")
	v2 = strings.TrimPrefix(strings.TrimSpace(v2), "v")

	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			n1, _ = strconv.Atoi(cleanNumeric(parts1[i]))
		}
		if i < len(parts2) {
			n2, _ = strconv.Atoi(cleanNumeric(parts2[i]))
		}

		if n1 > n2 {
			return 1
		}
		if n1 < n2 {
			return -1
		}
	}
	return 0
}

func cleanNumeric(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			sb.WriteRune(r)
		} else {
			break
		}
	}
	return sb.String()
}

// isTrustedUpdateHost reports whether host serves official GitHub release downloads.
func isTrustedUpdateHost(host string) bool {
	host = strings.ToLower(host)
	return host == "github.com" || host == "api.github.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

// validateUpdateURL rejects anything but HTTPS downloads from GitHub release hosts.
func validateUpdateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid update URL: %w", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("update URL must use https, got %q", u.Scheme)
	}
	if !isTrustedUpdateHost(u.Hostname()) {
		return fmt.Errorf("update host %q is not a trusted GitHub release host", u.Hostname())
	}
	return nil
}

// checkUpdateRedirect keeps release-asset redirects on trusted HTTPS hosts.
func checkUpdateRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("too many redirects")
	}
	if len(via) > 0 && !isTrustedUpdateHost(via[0].URL.Hostname()) {
		// The original request went to a custom (test) endpoint; leave it alone.
		return nil
	}
	return validateUpdateURL(req.URL.String())
}

// DownloadAndApplyUpdate downloads the update, verifies its SHA-256 digest
// against the release's checksum manifest, and launches a self-replacement
// restart script. Only the asset chosen by the last CheckForUpdates call is accepted.
func (s *UpdateService) DownloadAndApplyUpdate(ctx context.Context, downloadURL string) error {
	if downloadURL == "" {
		return errors.New("download URL cannot be empty")
	}
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return fmt.Errorf("automatic update is not supported on %s; download the new release manually", runtime.GOOS)
	}

	s.mu.Lock()
	pending := s.pending
	curVer := s.currentVersion
	s.mu.Unlock()

	if pending == nil || pending.downloadURL != downloadURL {
		return errors.New("update URL does not match the release offered by the last update check; check for updates again")
	}
	if err := validateUpdateURL(downloadURL); err != nil {
		return err
	}
	if pending.checksumURL == "" {
		return errors.New("release does not publish a SHA256SUMS file; refusing to install an unverified update")
	}
	if err := validateUpdateURL(pending.checksumURL); err != nil {
		return err
	}

	expectedSum, err := s.fetchExpectedChecksum(ctx, pending.checksumURL, pending.assetName, curVer)
	if err != nil {
		return err
	}

	currentExe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve current executable failed: %w", err)
	}
	currentExe, err = filepath.EvalSymlinks(currentExe)
	if err != nil {
		return fmt.Errorf("resolve executable symlinks failed: %w", err)
	}

	tempDir, err := os.MkdirTemp("", "nexterm_update_*")
	if err != nil {
		return fmt.Errorf("create update temp directory failed: %w", err)
	}
	handedOff := false
	defer func() {
		if !handedOff {
			_ = os.RemoveAll(tempDir)
		}
	}()

	downloadPath := filepath.Join(tempDir, "update_payload")
	actualSum, err := s.downloadToFile(ctx, downloadURL, downloadPath, curVer)
	if err != nil {
		return err
	}
	if !strings.EqualFold(actualSum, expectedSum) {
		return fmt.Errorf("update checksum mismatch for %s: expected %s, got %s", pending.assetName, expectedSum, actualSum)
	}

	switch runtime.GOOS {
	case "windows":
		targetNewExe := filepath.Join(tempDir, "NexTerm_new.exe")
		if strings.HasSuffix(strings.ToLower(pending.assetName), ".zip") {
			if err := extractExeFromZip(downloadPath, targetNewExe); err != nil {
				return fmt.Errorf("extract executable from update zip failed: %w", err)
			}
		} else if err := os.Rename(downloadPath, targetNewExe); err != nil {
			if err := copyFile(downloadPath, targetNewExe); err != nil {
				return fmt.Errorf("stage new executable failed: %w", err)
			}
		}

		fi, err := os.Stat(targetNewExe)
		if err != nil {
			return fmt.Errorf("downloaded binary validation failed: %w", err)
		}
		if fi.Size() < 1024*100 {
			return fmt.Errorf("downloaded binary validation failed: file is only %d bytes", fi.Size())
		}

		if err := applyWindowsHotRestart(currentExe, targetNewExe, tempDir); err != nil {
			return err
		}
		handedOff = true
		return nil

	case "darwin":
		if err := applyMacOSHotRestart(currentExe, downloadPath, tempDir); err != nil {
			return err
		}
		handedOff = true
		return nil

	case "linux":
		if err := applyLinuxHotRestart(currentExe, downloadPath, tempDir); err != nil {
			return err
		}
		handedOff = true
		return nil

	default:
		return fmt.Errorf("automatic update not implemented for %s", runtime.GOOS)
	}
}

// fetchExpectedChecksum downloads a sha256sum-style manifest and returns the digest for assetName.
func (s *UpdateService) fetchExpectedChecksum(ctx context.Context, checksumURL, assetName, curVer string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", checksumURL, nil)
	if err != nil {
		return "", fmt.Errorf("create checksum request failed: %w", err)
	}
	req.Header.Set("User-Agent", "NexTerm-Updater/"+curVer)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download checksum manifest failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksum server returned HTTP %d", resp.StatusCode)
	}

	sum, ok := parseChecksumManifest(io.LimitReader(resp.Body, 1<<20), assetName)
	if !ok {
		return "", fmt.Errorf("checksum manifest has no SHA-256 entry for %s", assetName)
	}
	return sum, nil
}

// parseChecksumManifest finds assetName in "<hex digest>  <file name>" lines.
func parseChecksumManifest(r io.Reader, assetName string) (string, bool) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		if path.Base(filepath.ToSlash(name)) != assetName {
			continue
		}
		digest := strings.ToLower(fields[0])
		if decoded, err := hex.DecodeString(digest); err == nil && len(decoded) == sha256.Size {
			return digest, true
		}
	}
	return "", false
}

// downloadToFile streams downloadURL into dest and returns the payload's hex SHA-256.
func (s *UpdateService) downloadToFile(ctx context.Context, downloadURL, dest, curVer string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return "", fmt.Errorf("create download request failed: %w", err)
	}
	req.Header.Set("User-Agent", "NexTerm-Updater/"+curVer)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download update failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download server returned HTTP %d", resp.StatusCode)
	}

	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("create temporary payload file failed: %w", err)
	}
	defer out.Close()

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(resp.Body, maxUpdatePayloadBytes+1))
	if err != nil {
		return "", fmt.Errorf("save update payload failed: %w", err)
	}
	if n > maxUpdatePayloadBytes {
		return "", fmt.Errorf("update payload exceeds %d bytes", maxUpdatePayloadBytes)
	}
	if err := out.Close(); err != nil {
		return "", fmt.Errorf("save update payload failed: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func extractExeFromZip(zipPath, destExePath string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".exe") {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			defer rc.Close()

			dst, err := os.OpenFile(destExePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
			if err != nil {
				return err
			}
			defer dst.Close()

			n, err := io.Copy(dst, io.LimitReader(rc, maxUpdatePayloadBytes+1))
			if err != nil {
				return err
			}
			if n > maxUpdatePayloadBytes {
				return fmt.Errorf("executable inside update zip exceeds %d bytes", maxUpdatePayloadBytes)
			}
			return nil
		}
	}
	return errors.New("no executable found inside update zip package")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return nil
}

func applyWindowsHotRestart(currentExe, newExe, tempDir string) error {
	batScriptPath := filepath.Join(tempDir, "apply_update.bat")

	// The script waits 1 second for the running process to terminate,
	// retries replacing the executable up to 15 times, launches the updated binary,
	// and cleans up temporary files.
	scriptContent := fmt.Sprintf(`@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

timeout /t 1 /nobreak >nul

set TARGET="%s"
set NEW="%s"
set RETRIES=0

:retry
copy /y %%NEW%% %%TARGET%% >nul 2>&1
if errorlevel 1 (
    set /a RETRIES+=1
    if !RETRIES! leq 15 (
        timeout /t 1 /nobreak >nul
        goto retry
    )
)

del %%NEW%% >nul 2>&1
start "" %%TARGET%%
exit
`, currentExe, newExe)

	if err := os.WriteFile(batScriptPath, []byte(scriptContent), 0700); err != nil {
		return fmt.Errorf("write restart script failed: %w", err)
	}

	// Detach and launch updater batch file
	cmd := exec.Command("cmd.exe", "/c", "start", "", batScriptPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch restart script failed: %w", err)
	}

	// Exit the current process to allow file overwrite
	go func() {
		time.Sleep(400 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}

func findMacAppBundle(exePath string) string {
	dir := filepath.Dir(exePath)
	for dir != "/" && dir != "." && dir != "" {
		if strings.HasSuffix(dir, ".app") {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func extractZipToDir(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		cleanName := filepath.Clean(f.Name)
		if strings.HasPrefix(cleanName, "..") || filepath.IsAbs(cleanName) {
			continue // Zip Slip protection
		}
		target := filepath.Join(destDir, cleanName)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		mode := f.FileInfo().Mode()
		if mode == 0 {
			mode = 0755
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		dst, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, mode)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(dst, io.LimitReader(rc, maxUpdatePayloadBytes+1))
		rc.Close()
		dst.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func extractTarGz(tarGzPath, destDir string) error {
	f, err := os.Open(tarGzPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		cleanName := filepath.Clean(header.Name)
		if strings.HasPrefix(cleanName, "..") || filepath.IsAbs(cleanName) {
			continue // Zip Slip protection
		}

		target := filepath.Join(destDir, cleanName)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			mode := header.FileInfo().Mode()
			if mode == 0 {
				mode = 0755
			}
			dst, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(dst, io.LimitReader(tr, maxUpdatePayloadBytes+1)); err != nil {
				dst.Close()
				return err
			}
			dst.Close()
		}
	}
	return nil
}

func applyMacOSHotRestart(currentExe, downloadZip, tempDir string) error {
	extractDir := filepath.Join(tempDir, "extracted")
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return fmt.Errorf("create macos extraction dir failed: %w", err)
	}

	// Try ditto first (standard macOS command preserving code signatures, symlinks, and resource forks)
	cmdDitto := exec.Command("/usr/bin/ditto", "-x", "-k", downloadZip, extractDir)
	if err := cmdDitto.Run(); err != nil {
		// Fallback to pure Go zip extractor
		if err := extractZipToDir(downloadZip, extractDir); err != nil {
			return fmt.Errorf("extract macOS bundle failed: %w", err)
		}
	}

	// Find the .app bundle in extractDir
	appPath := ""
	entries, _ := os.ReadDir(extractDir)
	for _, e := range entries {
		if strings.HasSuffix(strings.ToLower(e.Name()), ".app") {
			appPath = filepath.Join(extractDir, e.Name())
			break
		}
	}
	if appPath == "" {
		for _, e := range entries {
			if e.IsDir() {
				subEntries, _ := os.ReadDir(filepath.Join(extractDir, e.Name()))
				for _, sub := range subEntries {
					if strings.HasSuffix(strings.ToLower(sub.Name()), ".app") {
						appPath = filepath.Join(extractDir, e.Name(), sub.Name())
						break
					}
				}
			}
			if appPath != "" {
				break
			}
		}
	}

	if appPath == "" {
		return fmt.Errorf("no .app bundle found inside macOS update package")
	}

	// Remove any Gatekeeper quarantine flag from downloaded files
	_ = exec.Command("/usr/bin/xattr", "-cr", appPath).Run()

	targetApp := findMacAppBundle(currentExe)
	if targetApp == "" {
		targetApp = currentExe
	}

	scriptPath := filepath.Join(tempDir, "apply_update.sh")
	pid := os.Getpid()
	scriptContent := fmt.Sprintf(`#!/bin/bash
PID=%d
TARGET="%s"
SOURCE="%s"
TEMP_DIR="%s"

for i in $(seq 1 30); do
    if ! kill -0 $PID 2>/dev/null; then
        break
    fi
    sleep 0.5
done

if [ -d "$TARGET" ]; then
    rm -rf "$TARGET"
    cp -R "$SOURCE" "$TARGET"
    xattr -cr "$TARGET" 2>/dev/null || true
    open -n "$TARGET"
elif [ -f "$TARGET" ]; then
    SOURCE_BIN=$(find "$SOURCE" -type f -perm +111 2>/dev/null | head -n 1)
    if [ -n "$SOURCE_BIN" ]; then
        cp -f "$SOURCE_BIN" "$TARGET"
        chmod 0755 "$TARGET"
        "$TARGET" &
    fi
fi

rm -rf "$TEMP_DIR"
exit 0
`, pid, targetApp, appPath, tempDir)

	if err := os.WriteFile(scriptPath, []byte(scriptContent), 0755); err != nil {
		return fmt.Errorf("write macOS restart script failed: %w", err)
	}

	cmd := exec.Command("/bin/bash", scriptPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch macOS restart script failed: %w", err)
	}

	go func() {
		time.Sleep(300 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}

func applyLinuxHotRestart(currentExe, downloadTarGz, tempDir string) error {
	extractDir := filepath.Join(tempDir, "extracted")
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return fmt.Errorf("create linux extraction dir failed: %w", err)
	}

	lower := strings.ToLower(downloadTarGz)
	if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
		cmdTar := exec.Command("tar", "-xzf", downloadTarGz, "-C", extractDir)
		if err := cmdTar.Run(); err != nil {
			if err := extractTarGz(downloadTarGz, extractDir); err != nil {
				return fmt.Errorf("extract Linux tarball failed: %w", err)
			}
		}
	} else if strings.HasSuffix(lower, ".zip") {
		if err := extractZipToDir(downloadTarGz, extractDir); err != nil {
			return fmt.Errorf("extract Linux zip failed: %w", err)
		}
	} else {
		_ = copyFile(downloadTarGz, filepath.Join(extractDir, "nexterm"))
	}

	newBinary := filepath.Join(extractDir, "nexterm")
	if _, err := os.Stat(newBinary); err != nil {
		entries, _ := os.ReadDir(extractDir)
		for _, e := range entries {
			if !e.IsDir() {
				p := filepath.Join(extractDir, e.Name())
				if fi, err := os.Stat(p); err == nil && fi.Mode()&0111 != 0 {
					newBinary = p
					break
				}
			}
		}
	}

	if fi, err := os.Stat(newBinary); err != nil || fi.Size() < 1024*100 {
		return fmt.Errorf("downloaded Linux binary validation failed")
	}

	_ = os.Chmod(newBinary, 0755)

	scriptPath := filepath.Join(tempDir, "apply_update.sh")
	pid := os.Getpid()
	scriptContent := fmt.Sprintf(`#!/bin/bash
PID=%d
TARGET="%s"
SOURCE="%s"
TEMP_DIR="%s"

for i in $(seq 1 30); do
    if ! kill -0 $PID 2>/dev/null; then
        break
    fi
    sleep 0.5
done

cp -f "$SOURCE" "$TARGET"
chmod 0755 "$TARGET"
nohup "$TARGET" >/dev/null 2>&1 &
rm -rf "$TEMP_DIR"
exit 0
`, pid, currentExe, newBinary, tempDir)

	if err := os.WriteFile(scriptPath, []byte(scriptContent), 0755); err != nil {
		return fmt.Errorf("write Linux restart script failed: %w", err)
	}

	cmd := exec.Command("/bin/bash", scriptPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch Linux restart script failed: %w", err)
	}

	go func() {
		time.Sleep(300 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}
