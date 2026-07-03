package endpoints

import (
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"money/backend/state"
)

// FrontendHandler serves the SPA on every non-API route. Document navigations
// (the app shell / deep links) pass through the session gate first: no session
// means the user never loads the app, they are bounced straight to login. Assets
// and the HMR websocket are served without a gate.
//
// With DevViteUrl set it reverse-proxies to the Vite dev server (HMR); otherwise
// it serves the embedded build, falling back to index.html for client routes.
func FrontendHandler(st *state.State, dist fs.FS) http.Handler {
	var proxy http.Handler
	if st.Config.DevViteUrl != "" {
		target, err := url.Parse(st.Config.DevViteUrl)
		if err != nil {
			panic(fmt.Errorf("invalid DEV_VITE_URL: %w", err))
		}
		proxy = httputil.NewSingleHostReverseProxy(target)
	}
	files := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isNavigation(r) {
			if _, err := Authenticate(st, r); err != nil {
				http.Redirect(w, r, "/api/v1/auth/login", http.StatusFound)
				return
			}
		}

		if proxy != nil {
			proxy.ServeHTTP(w, r)
			return
		}

		if isNavigation(r) {
			serveIndex(w, dist)
			return
		}
		files.ServeHTTP(w, r)
	})
}

// isNavigation reports whether the request is a top-level document load (a page
// navigation) as opposed to an asset fetch or the HMR websocket.
func isNavigation(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Dest") == "document" {
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

func serveIndex(w http.ResponseWriter, dist fs.FS) {
	f, err := dist.Open("index.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.Copy(w, f)
}
