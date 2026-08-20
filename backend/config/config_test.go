package config

import (
	"bytes"
	"encoding/json"
	"log/slog"
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

func TestConfigLogValueRedactsSensitiveValues(t *testing.T) {
	c := &Config{
		BackendUrl: "https://dash.example",
		DbUrl:      "postgres://user:db-password@db.example/dash",
		OIDC: OIDCConfig{
			ClientSecret: "oidc-secret",
		},
		EnableBanking: EnableBankingConfig{
			PrivateKeyPath: "/secret/private-key.pem",
		},
	}

	var output bytes.Buffer
	slog.New(slog.NewJSONHandler(&output, nil)).Info("loaded config", "config", c)

	var event map[string]any
	require.NoError(t, json.Unmarshal(output.Bytes(), &event))
	loggedConfig, ok := event["config"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "https://dash.example", loggedConfig["backend_url"])
	require.Equal(t, "[REDACTED]", loggedConfig["db_url"])

	loggedOIDC, ok := loggedConfig["oidc"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "[REDACTED]", loggedOIDC["client_secret"])

	loggedEnableBanking, ok := loggedConfig["enable_banking"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "[REDACTED]", loggedEnableBanking["private_key_path"])

	require.NotContains(t, output.String(), "db-password")
	require.NotContains(t, output.String(), "oidc-secret")
	require.NotContains(t, output.String(), "private-key.pem")
}
