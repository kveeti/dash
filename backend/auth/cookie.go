package auth

import (
	"fmt"
	"net/http"
	"time"
)

const CookieName = "auth"
const FlowCookieName = "oidc_flow"

func CreateCookie(token string, expiry *time.Time, isSecure bool) *http.Cookie {
	cookie := http.Cookie{
		Name:     CookieName,
		Value:    token,
		Secure:   isSecure,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	}

	if expiry != nil {
		cookie.Expires = *expiry
	}

	return &cookie
}

// CreateFlowCookie holds the short-lived OIDC login state (state/nonce/PKCE)
// between the login redirect and the callback. SameSite=Lax so it survives the
// top-level redirect back from the provider.
func CreateFlowCookie(value string, isSecure bool) *http.Cookie {
	return &http.Cookie{
		Name:     FlowCookieName,
		Value:    value,
		Secure:   isSecure,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   600,
	}
}

// ClearFlowCookie expires the flow cookie once the callback has consumed it.
func ClearFlowCookie(isSecure bool) *http.Cookie {
	return &http.Cookie{
		Name:     FlowCookieName,
		Value:    "",
		Secure:   isSecure,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
		MaxAge:   -1,
	}
}

func GetCookie(r *http.Request) (*http.Cookie, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return nil, fmt.Errorf("no auth cookie")
	}

	return cookie, nil
}
