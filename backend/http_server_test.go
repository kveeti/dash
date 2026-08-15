package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHTTPServerTimeouts(t *testing.T) {
	server := NewHttpServer(http.NotFoundHandler(), ":0").server

	require.Equal(t, readHeaderTimeout, server.ReadHeaderTimeout)
	require.Equal(t, readTimeout, server.ReadTimeout)
	require.Equal(t, writeTimeout, server.WriteTimeout)
	require.Equal(t, idleTimeout, server.IdleTimeout)
}

func TestHTTPServerShutdown(t *testing.T) {
	server := NewHttpServer(http.NotFoundHandler(), "127.0.0.1:0")
	require.NoError(t, server.Start())
	require.NoError(t, server.Shutdown())

	select {
	case err := <-server.Done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("server did not stop")
	}
}
