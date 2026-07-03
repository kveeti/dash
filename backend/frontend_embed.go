package main

import (
	"embed"
	"io/fs"
)

// frontendDist holds the built SPA. `make build-frontend` writes Vite's output
// into webdist/. all: keeps the committed .gitkeep so this compiles before any
// build; a real deploy builds the frontend first.
//
//go:embed all:webdist
var frontendDist embed.FS

func frontendFS() fs.FS {
	sub, err := fs.Sub(frontendDist, "webdist")
	if err != nil {
		panic(err)
	}
	return sub
}
