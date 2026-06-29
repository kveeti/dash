package main

import (
	"log/slog"
	"money/backend/config"
	"os"
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
