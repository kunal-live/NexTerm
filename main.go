package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
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
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
