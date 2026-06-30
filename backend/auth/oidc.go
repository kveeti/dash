package auth

import (
	"context"
	"fmt"
	"money/backend/config"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDC wraps the provider, oauth2 config and ID token verifier. It is built
// once at startup (discovery hits the issuer's network endpoint).
type OIDC struct {
	oauth2   oauth2.Config
	verifier *oidc.IDTokenVerifier
}

func NewOIDC(ctx context.Context, c config.OIDCConfig) (*OIDC, error) {
	provider, err := oidc.NewProvider(ctx, c.Issuer)
	if err != nil {
		return nil, fmt.Errorf("error creating oidc provider: %w", err)
	}

	return &OIDC{
		oauth2: oauth2.Config{
			ClientID:     c.ClientID,
			ClientSecret: c.ClientSecret,
			RedirectURL:  c.RedirectURL,
			Endpoint:     provider.Endpoint(),
			Scopes:       []string{oidc.ScopeOpenID, "email"},
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: c.ClientID}),
	}, nil
}

// NewPKCEVerifier returns a random PKCE code verifier.
func NewPKCEVerifier() string {
	return oauth2.GenerateVerifier()
}

// AuthCodeURL builds the provider authorization URL for the login redirect.
func (o *OIDC) AuthCodeURL(state, nonce, pkceVerifier string) string {
	return o.oauth2.AuthCodeURL(state,
		oidc.Nonce(nonce),
		oauth2.S256ChallengeOption(pkceVerifier),
	)
}

type Claims struct {
	Subject string
	Issuer  string
	Email   string
}

// Exchange completes the code exchange and verifies the returned ID token,
// including the nonce, returning the identity claims.
func (o *OIDC) Exchange(ctx context.Context, code, nonce, pkceVerifier string) (*Claims, error) {
	tok, err := o.oauth2.Exchange(ctx, code, oauth2.VerifierOption(pkceVerifier))
	if err != nil {
		return nil, fmt.Errorf("error exchanging code: %w", err)
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok {
		return nil, fmt.Errorf("no id_token in token response")
	}

	idToken, err := o.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("error verifying id_token: %w", err)
	}

	if idToken.Nonce != nonce {
		return nil, fmt.Errorf("nonce mismatch")
	}

	var claims struct {
		Email string `json:"email"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("error parsing claims: %w", err)
	}

	return &Claims{
		Subject: idToken.Subject,
		Issuer:  idToken.Issuer,
		Email:   claims.Email,
	}, nil
}
