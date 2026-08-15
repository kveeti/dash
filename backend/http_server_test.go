package main

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHTTPServerTimeouts(t *testing.T) {
	server := NewHttpServer(http.NotFoundHandler(), ":0").server

	require.Equal(t, readHeaderTimeout, server.ReadHeaderTimeout)
	require.Equal(t, readTimeout, server.ReadTimeout)
	require.Equal(t, writeTimeout, server.WriteTimeout)
	require.Equal(t, idleTimeout, server.IdleTimeout)
}
