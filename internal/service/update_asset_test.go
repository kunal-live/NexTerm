package service

import "testing"

func assetsNamed(names ...string) []githubReleaseAsset {
	out := make([]githubReleaseAsset, len(names))
	for i, n := range names {
		out[i] = githubReleaseAsset{Name: n, BrowserDownloadURL: "https://github.com/x/y/releases/download/v1/" + n}
	}
	return out
}

func TestSelectUpdateAsset(t *testing.T) {
	release := assetsNamed(
		"NexTerm-Setup-v1.5.0.exe",
		"NexTerm-Setup.exe",
		"Nexterm-v1.5.0-linux-amd64.tar.gz",
		"Nexterm-linux-arm64.tar.gz",
		"Nexterm-linux-x64.tar.gz",
		"Nexterm-macos-arm64.zip",
		"Nexterm-macos-amd64.zip",
		"Nexterm-windows-x64-portable.zip",
		"SHA256SUMS",
		"nexterm.exe",
	)
	cases := []struct {
		goos, goarch, want string
	}{
		{"windows", "amd64", "nexterm.exe"},
		{"darwin", "arm64", "Nexterm-macos-arm64.zip"},
		{"darwin", "amd64", "Nexterm-macos-amd64.zip"},
		{"linux", "amd64", ""}, // checked below: must be an amd64 tarball
		{"linux", "arm64", "Nexterm-linux-arm64.tar.gz"},
	}
	for _, c := range cases {
		got := selectUpdateAsset(c.goos, c.goarch, release)
		if got == nil {
			t.Errorf("%s/%s: no asset selected", c.goos, c.goarch)
			continue
		}
		if c.want != "" && got.Name != c.want {
			t.Errorf("%s/%s: got %q, want %q", c.goos, c.goarch, got.Name, c.want)
		}
	}
	if got := selectUpdateAsset("linux", "amd64", release); got == nil || got.Name == "Nexterm-linux-arm64.tar.gz" {
		t.Errorf("linux/amd64 must not pick the arm64 build, got %v", got)
	}
}

func TestSelectUpdateAssetNeverPicksInstallerOrOtherArch(t *testing.T) {
	// Windows: only an installer is published -> nothing the updater can apply.
	if got := selectUpdateAsset("windows", "amd64", assetsNamed("NexTerm-Setup.exe", "SHA256SUMS")); got != nil {
		t.Errorf("installer must not be selected, got %q", got.Name)
	}
	// macOS Intel machine, only an Apple Silicon build exists.
	if got := selectUpdateAsset("darwin", "amd64", assetsNamed("Nexterm-macos-arm64.zip")); got != nil {
		t.Errorf("arm64 build must not be offered to amd64, got %q", got.Name)
	}
	// An asset with no architecture in its name is acceptable.
	if got := selectUpdateAsset("darwin", "arm64", assetsNamed("Nexterm-macos.zip")); got == nil {
		t.Errorf("arch-less macOS asset should be selected")
	}
}
