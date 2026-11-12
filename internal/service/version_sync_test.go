package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The updater compares CurrentAppVersion with the latest release tag, and CI tags
// releases from wails.json. If they drift, installed apps either never see an
// update or are offered the same one forever.
func TestAppVersionMatchesWailsJSON(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "wails.json"))
	if err != nil {
		t.Skip("wails.json not found")
	}
	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Info.ProductVersion != CurrentAppVersion {
		t.Fatalf("wails.json productVersion %q != CurrentAppVersion %q: bump both together",
			cfg.Info.ProductVersion, CurrentAppVersion)
	}
}
