package main

import (
	"embed"
	"io/fs"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend
var rawAssets embed.FS

func main() {
	app := NewApp()

	// Strip the leading "frontend/" prefix so index.html serves at the
	// asset-server root, matching the standard wails-generated layout.
	assets, err := fs.Sub(rawAssets, "frontend")
	if err != nil {
		log.Fatal(err)
	}

	// On macOS, native Edit and Application menus are required so that
	// Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z work properly in WebKit inputs.
	var appMenu *menu.Menu
	if runtime.GOOS == "darwin" {
		appMenu = menu.NewMenu()
		appMenu.Append(menu.AppMenu())
		appMenu.Append(menu.EditMenu())
		appMenu.Append(menu.WindowMenu())
	}

	err = wails.Run(&options.App{
		Title:            "Nexterm - SSH & Terminal Manager",
		Width:            1280,
		Height:           820,
		MinWidth:         1024,
		MinHeight:        640,
		WindowStartState: options.Maximised,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.onWailsStartup,
		Bind: []interface{}{
			app,
		},
		Menu: appMenu,
		Windows: &windows.Options{
			WebviewIsTransparent: false,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarDefault(),
			WebviewIsTransparent: false,
			Appearance:           mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "NexTerm",
				Message: "Professional Desktop SSH & Systems Workspace\nVersion 1.4.1",
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
