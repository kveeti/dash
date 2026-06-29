package main

import (
	"context"
	"fmt"
	"log/slog"
	"money/backend/config"
	"money/backend/data"
	"money/backend/endpoints"
	"money/backend/state"
	"os"
	"os/signal"
)

// App wires up the data layer, router and http server and blocks until shutdown.
// started, if non-nil, receives once the server is listening (used by tests).
func App(config *config.Config, started chan struct{}) {
	if config.IsProd {
		slog.Info("starting in prod")
	} else {
		slog.Info("starting in dev")
	}

	data, err := data.NewData(context.TODO(), config.DbUrl)
	if err != nil {
		panic(err)
	}

	router := endpoints.GetRouter(state.NewState(data, config))

	s := NewHttpServer(router, ":8000")
	if err := s.Start(); err != nil {
		panic(fmt.Errorf("error starting server: %w", err))
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	go func() {
		<-stop
		s.Shutdown()
	}()

	<-s.Started
	if started != nil {
		started <- struct{}{}
	}

	<-s.Done
}
