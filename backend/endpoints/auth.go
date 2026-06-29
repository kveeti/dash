package endpoints

import (
	"money/backend/auth"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"time"
)

const sessionDuration = 7 * 24 * time.Hour

// HandleLogin starts the OIDC authorization-code flow.
//
// TODO(oidc): build the provider authorization URL and redirect the user to it.
// Wire up github.com/coreos/go-oidc/v3/oidc + golang.org/x/oauth2:
//
//	provider, _ := oidc.NewProvider(ctx, state.Config.OIDC.Issuer)
//	oauth2Config := oauth2.Config{
//	    ClientID:     state.Config.OIDC.ClientID,
//	    ClientSecret: state.Config.OIDC.ClientSecret,
//	    RedirectURL:  state.Config.OIDC.RedirectURL,
//	    Endpoint:     provider.Endpoint(),
//	    Scopes:       []string{oidc.ScopeOpenID, "email"},
//	}
//
// Generate a random `state` (and ideally PKCE/nonce), store it in a short-lived
// cookie, then http.Redirect to oauth2Config.AuthCodeURL(state).
func HandleLogin(state *state.State) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		return NewErr("oidc login not implemented", http.StatusNotImplemented)
	}
}

// HandleCallback completes the OIDC flow: validates `state`, exchanges the code
// for tokens, verifies the ID token, upserts the user, creates a session and
// sets the auth cookie.
//
// TODO(oidc):
//  1. verify the `state` cookie matches r.URL.Query().Get("state")
//  2. oauth2Token, _ := oauth2Config.Exchange(ctx, r.URL.Query().Get("code"))
//  3. rawIDToken := oauth2Token.Extra("id_token").(string)
//  4. idToken, _ := verifier.Verify(ctx, rawIDToken)  // verifier from provider
//  5. var claims struct{ Sub, Email string }; idToken.Claims(&claims)
//  6. upsert user via state.Data.GetUserBySubject / InsertUser
//  7. create session + cookie (see issueSession below) and redirect to FrontUrl
func HandleCallback(state *state.State) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		return NewErr("oidc callback not implemented", http.StatusNotImplemented)
	}
}

func HandleLogout(state *state.State) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		info, err := Authenticate(state, r)
		if err != nil {
			return err
		}

		if err := state.Data.DeleteSession(r.Context(), info.SessionID); err != nil {
			return NewUnexpectedErr("error deleting session: %w", err)
		}

		expired := time.Unix(0, 0)
		http.SetCookie(w, auth.CreateCookie("", &expired, state.Config.IsProd))

		Json(w, JSON{"ok": true})
		return nil
	}
}

// issueSession creates a session row, signs a token and sets the auth cookie.
// Call this from HandleCallback once the OIDC identity is verified.
func issueSession(w http.ResponseWriter, st *state.State, r *http.Request, userID string) error {
	session := data.Session{
		ID:        data.NewSessionID(),
		UserID:    userID,
		CreatedAt: time.Now(),
	}
	if err := st.Data.InsertSession(r.Context(), session); err != nil {
		return NewUnexpectedErr("error inserting session: %w", err)
	}

	expiry := time.Now().Add(sessionDuration)
	token := auth.CreateToken(st.Config.Secret, userID, session.ID, expiry)
	http.SetCookie(w, auth.CreateCookie(token, &expiry, st.Config.IsProd))

	return nil
}
