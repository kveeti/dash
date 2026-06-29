package config

import (
	"fmt"
	"os"
)

type Config struct {
	IsProd   bool
	FrontUrl string
	Secret   string
	DbUrl    string

	// OIDC provider settings (scaffold).
	OIDC OIDCConfig
}

type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

func LoadConfig() (*Config, error) {
	config := &Config{
		IsProd:   os.Getenv("IS_PROD") == "1",
		FrontUrl: os.Getenv("FRONT_URL"),
		Secret:   os.Getenv("SECRET"),
		DbUrl:    os.Getenv("DB_URL"),
		OIDC: OIDCConfig{
			Issuer:       os.Getenv("OIDC_ISSUER"),
			ClientID:     os.Getenv("OIDC_CLIENT_ID"),
			ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
			RedirectURL:  os.Getenv("OIDC_REDIRECT_URL"),
		},
	}

	if config.FrontUrl == "" {
		return nil, fmt.Errorf("invalid config: FRONT_URL not set")
	}

	if config.Secret == "" {
		return nil, fmt.Errorf("invalid config: SECRET not set")
	}

	if config.DbUrl == "" {
		return nil, fmt.Errorf("invalid config: DB_URL not set")
	}

	return config, nil
}
