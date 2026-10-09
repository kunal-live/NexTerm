package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CurrentAppVersion defines the running application version.
const CurrentAppVersion = "1.3.0"

// DefaultUpdateRepo is the default GitHub repository to query for updates.
const DefaultUpdateRepo = "kunal-live/NexTerm"

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

// UpdateService manages checking, downloading, and applying in-app updates.
type UpdateService struct {
	mu             sync.Mutex
	client         *http.Client
	repo           string
	customEndpoint string
	currentVersion string
	emitter        EventEmitter
}

// NewUpdateService creates an UpdateService instance.
func NewUpdateService(emitter EventEmitter) *UpdateService {
	repo := os.Getenv("NEXTERM_UPDATE_REPO")
	if repo == "" {
		repo = DefaultUpdateRepo
	}
	return &UpdateService{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		repo:           repo,
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
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release metadata failed: %w", err)
	}

	cleanLatest := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	cleanCurrent := strings.TrimPrefix(strings.TrimSpace(curVer), "v")

	hasUpdate := CompareVersions(cleanLatest, cleanCurrent) > 0

	// Select the best asset for the platform
	var selectedAsset *githubReleaseAsset
	for _, asset := range rel.Assets {
		lower := strings.ToLower(asset.Name)
		if runtime.GOOS == "windows" {
			// Prioritize direct portable executable, then portable zip, then setup exe
			if lower == "nexterm.exe" {
				selectedAsset = &asset
				break
			}
			if strings.Contains(lower, "portable") && strings.HasSuffix(lower, ".zip") {
				selectedAsset = &asset
			} else if selectedAsset == nil && (strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".exe")) {
				selectedAsset = &asset
			}
		} else {
			if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".zip") {
				selectedAsset = &asset
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

	if selectedAsset != nil {
		info.DownloadURL = selectedAsset.BrowserDownloadURL
		info.AssetName = selectedAsset.Name
		info.AssetSize = selectedAsset.Size
	}

	return info, nil
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

// DownloadAndApplyUpdate downloads the update and launches a self-replacement restart script.
func (s *UpdateService) DownloadAndApplyUpdate(ctx context.Context, downloadURL string) error {
	if downloadURL == "" {
		return errors.New("download URL cannot be empty")
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

	downloadPath := filepath.Join(tempDir, "update_payload")
	out, err := os.Create(downloadPath)
	if err != nil {
		return fmt.Errorf("create temporary payload file failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		out.Close()
		return fmt.Errorf("create download request failed: %w", err)
	}
	req.Header.Set("User-Agent", "NexTerm-Updater/"+s.currentVersion)

	resp, err := s.client.Do(req)
	if err != nil {
		out.Close()
		return fmt.Errorf("download update failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		out.Close()
		return fmt.Errorf("download server returned HTTP %d", resp.StatusCode)
	}

	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		return fmt.Errorf("save update payload failed: %w", err)
	}
	out.Close()

	// If download was a zip archive, extract the executable
	targetNewExe := filepath.Join(tempDir, "NexTerm_new.exe")
	if strings.HasSuffix(strings.ToLower(downloadURL), ".zip") {
		if err := extractExeFromZip(downloadPath, targetNewExe); err != nil {
			return fmt.Errorf("extract executable from update zip failed: %w", err)
		}
	} else {
		// Payload is directly an executable
		if err := os.Rename(downloadPath, targetNewExe); err != nil {
			// If rename fails across volumes, copy
			if err := copyFile(downloadPath, targetNewExe); err != nil {
				return fmt.Errorf("stage new executable failed: %w", err)
			}
		}
	}

	// Verify the executable file exists and is non-empty
	fi, err := os.Stat(targetNewExe)
	if err != nil || fi.Size() < 1024*100 {
		return fmt.Errorf("downloaded binary validation failed (size=%d): %v", fi.Size(), err)
	}

	// Hot-replacement and restart
	if runtime.GOOS == "windows" {
		return applyWindowsHotRestart(currentExe, targetNewExe, tempDir)
	}

	return fmt.Errorf("automatic restart not implemented on %s", runtime.GOOS)
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

			if _, err := io.Copy(dst, rc); err != nil {
				return err
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

	if err := os.WriteFile(batScriptPath, []byte(scriptContent), 0755); err != nil {
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
