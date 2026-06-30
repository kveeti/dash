package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// setRequired sets every mandatory env var to a valid value for the test scope.
func setRequired(t *testing.T) {
	t.Setenv("BACKEND_URL", "http://localhost:8000")
	t.Setenv("DB_URL", "postgres://localhost/db")
	t.Setenv("OIDC_ISSUER", "https://issuer.example")
	t.Setenv("OIDC_CLIENT_ID", "client")
	t.Setenv("OIDC_CLIENT_SECRET", "secret")
	// Optional vars default to empty.
	t.Setenv("FRONT_URL", "")
	t.Setenv("OIDC_REDIRECT_URL", "")
}

func TestLoadConfig_RedirectURLDefaultsToBackend(t *testing.T) {
	setRequired(t)

	c, err := LoadConfig()
	require.NoError(t, err)
	require.Equal(t, "http://localhost:8000/api/v1/auth/callback", c.OIDC.RedirectURL)
}

func TestLoadConfig_RedirectURLHonoredWhenSet(t *testing.T) {
	setRequired(t)
	t.Setenv("OIDC_REDIRECT_URL", "https://proxy.example/weird/cb")

	c, err := LoadConfig()
	require.NoError(t, err)
	require.Equal(t, "https://proxy.example/weird/cb", c.OIDC.RedirectURL)
}

func TestLoadConfig_FrontURLOptional(t *testing.T) {
	setRequired(t) // FRONT_URL empty

	c, err := LoadConfig()
	require.NoError(t, err)
	require.Equal(t, "", c.FrontUrl)
	// Same-origin: effective front url is the backend's own url.
	require.Equal(t, "http://localhost:8000", c.EffectiveFrontUrl())
}

func TestLoadConfig_FrontURLUsedWhenSet(t *testing.T) {
	setRequired(t)
	t.Setenv("FRONT_URL", "http://localhost:3000")

	c, err := LoadConfig()
	require.NoError(t, err)
	require.Equal(t, "http://localhost:3000", c.EffectiveFrontUrl())
}

func TestLoadConfig_MissingRequiredErrors(t *testing.T) {
	for _, missing := range []string{"BACKEND_URL", "DB_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"} {
		t.Run(missing, func(t *testing.T) {
			setRequired(t)
			t.Setenv(missing, "")

			_, err := LoadConfig()
			require.ErrorContains(t, err, missing)
		})
	}
}
