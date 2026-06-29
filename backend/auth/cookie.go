package auth

import (
	"fmt"
	"net/http"
	"time"
)

const CookieName = "auth"

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

func GetCookie(r *http.Request) (*http.Cookie, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return nil, fmt.Errorf("no auth cookie")
	}

	return cookie, nil
}
