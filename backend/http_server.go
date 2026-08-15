package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

const (
	GRACE_PERIOD      = 5 * time.Second
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 30 * time.Second
	idleTimeout       = time.Minute
)

type HttpServer struct {
	server *http.Server

	Done    chan struct{}
	Started chan struct{}
}

func NewHttpServer(handler http.Handler, addr string) HttpServer {
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	return HttpServer{
		server:  server,
		Done:    make(chan struct{}),
		Started: make(chan struct{}),
	}
}

func (s *HttpServer) Start() error {
	addr := s.server.Addr

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("error listening on %s: %w", addr, err)
	}

	go func() {
		s.Started <- struct{}{}
		slog.Info("listening on " + addr)
		if err = s.server.Serve(listener); err != nil {
			slog.Error("server error: " + err.Error())
		}
	}()

	return nil
}

func (s *HttpServer) Shutdown() {
	slog.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), GRACE_PERIOD)
	defer cancel()

	s.server.Shutdown(ctx)

	s.Done <- struct{}{}
}
