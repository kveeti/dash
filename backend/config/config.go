package config

import (
	"fmt"
	"os"
)

type Config struct {
	IsProd     bool
	Port       string
	BackendUrl string
	// FrontUrl is empty when the frontend is served from the same origin as the
	// backend. When set (separate origin, e.g. a dev server) it enables CORS and
	// is used as the post-login redirect target.
	FrontUrl string
	// DevViteUrl, when set, makes the backend reverse-proxy every non-API request
	// to the Vite dev server at this URL (for HMR) instead of serving the embedded
	// build. Empty = serve the embedded frontend. Dev only.
	DevViteUrl string
	DbUrl      string

	// ImportStore selects where uploaded import files are kept: "disk" (under
	// ImportDir) or "postgres" (default, bytea).
	ImportStore     string
	ImportDir       string
	DisableRateSync bool

	OIDC          OIDCConfig
	EnableBanking EnableBankingConfig
}

// EnableBankingConfig is optional. The integration is available only when both
// the application ID and private key path are set.
type EnableBankingConfig struct {
	ApplicationID  string
	PrivateKeyPath string
	APIOrigin      string
}

func (c EnableBankingConfig) Enabled() bool {
	return c.ApplicationID != "" && c.PrivateKeyPath != ""
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	config := &Config{
		IsProd:          os.Getenv("IS_PROD") == "1",
		Port:            port,
		BackendUrl:      os.Getenv("BACKEND_URL"),
		FrontUrl:        os.Getenv("FRONT_URL"),
		DevViteUrl:      os.Getenv("DEV_VITE_URL"),
		DbUrl:           os.Getenv("DB_URL"),
		ImportStore:     os.Getenv("IMPORT_STORE"),
		ImportDir:       os.Getenv("IMPORT_DIR"),
		DisableRateSync: os.Getenv("DISABLE_RATE_SYNC") == "1",
		EnableBanking: EnableBankingConfig{
			ApplicationID:  os.Getenv("ENABLEBANKING_APP_ID"),
			PrivateKeyPath: os.Getenv("ENABLEBANKING_PRIVATE_KEY"),
			APIOrigin:      os.Getenv("ENABLEBANKING_API_ORIGIN"),
		},
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

	if config.EnableBanking.APIOrigin == "" {
		config.EnableBanking.APIOrigin = "https://api.enablebanking.com"
	}
	if (config.EnableBanking.ApplicationID == "") != (config.EnableBanking.PrivateKeyPath == "") {
		return nil, fmt.Errorf("invalid config: ENABLEBANKING_APP_ID and ENABLEBANKING_PRIVATE_KEY must be set together")
	}

	// OIDC_REDIRECT_URL defaults to the backend's own callback; set it
	// explicitly only for non-standard setups (proxies, path rewrites, ...).
	if config.OIDC.RedirectURL == "" {
		config.OIDC.RedirectURL = config.BackendUrl + callbackPath
	}

	return config, nil
}
