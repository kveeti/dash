package main

import (
	"log/slog"
	"money/backend/config"
	"os"
	_ "time/tzdata" // embed the IANA tz database so import timezone parsing works on any image
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	config, err := config.LoadConfig()
	if err != nil {
		panic(err)
	}

	App(config, nil)

	slog.Info("bye!")
}
