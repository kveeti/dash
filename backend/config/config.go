package config

import (
	"fmt"
	"os"
)

type Config struct {
	IsProd     bool
	BackendUrl string
	// FrontUrl is empty when the frontend is served from the same origin as the
	// backend. When set (separate origin, e.g. a dev server) it enables CORS and
	// is used as the post-login redirect target.
	FrontUrl string
	DbUrl    string

	OIDC OIDCConfig
}

// callbackPath must match the OIDC callback route in the router.
const callbackPath = "/api/v1/auth/callback"

type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

// EffectiveFrontUrl is where users are sent after login: FrontUrl if set,
// otherwise the backend's own URL (same-origin frontend).
func (c *Config) EffectiveFrontUrl() string {
	if c.FrontUrl != "" {
		return c.FrontUrl
	}
	return c.BackendUrl
}

func LoadConfig() (*Config, error) {
	config := &Config{
		IsProd:     os.Getenv("IS_PROD") == "1",
		BackendUrl: os.Getenv("BACKEND_URL"),
		FrontUrl:   os.Getenv("FRONT_URL"),
		DbUrl:      os.Getenv("DB_URL"),
		OIDC: OIDCConfig{
			Issuer:       os.Getenv("OIDC_ISSUER"),
			ClientID:     os.Getenv("OIDC_CLIENT_ID"),
			ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
			RedirectURL:  os.Getenv("OIDC_REDIRECT_URL"),
		},
	}

	required := map[string]string{
		"BACKEND_URL":        config.BackendUrl,
		"DB_URL":             config.DbUrl,
		"OIDC_ISSUER":        config.OIDC.Issuer,
		"OIDC_CLIENT_ID":     config.OIDC.ClientID,
		"OIDC_CLIENT_SECRET": config.OIDC.ClientSecret,
	}
	for name, value := range required {
		if value == "" {
			return nil, fmt.Errorf("invalid config: %s not set", name)
		}
	}

	// OIDC_REDIRECT_URL defaults to the backend's own callback; set it
	// explicitly only for non-standard setups (proxies, path rewrites, ...).
	if config.OIDC.RedirectURL == "" {
		config.OIDC.RedirectURL = config.BackendUrl + callbackPath
	}

	return config, nil
}
