package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"money/backend/auth"
	"money/backend/data"
	"money/backend/state"
)

func GetRouter(state *state.State, dist fs.FS) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/v1/auth/login", NewHandler(HandleLogin(state)))
	mux.HandleFunc("GET /api/v1/auth/callback", NewHandler(HandleCallback(state)))
	mux.HandleFunc("POST /api/v1/auth/logout", NewHandler(HandleLogout(state)))

	getUserID := GetUserIDMiddleware(state)

	mux.HandleFunc("GET /api/v1/users/@me", NewHandler(HandleGetMe(state, getUserID)))

	mux.HandleFunc("GET /api/v1/buckets", NewHandler(HandleListBuckets(state, getUserID)))
	mux.HandleFunc("POST /api/v1/buckets", NewHandler(HandleCreateBucket(state, getUserID)))

	mux.HandleFunc("GET /api/v1/transactions", NewHandler(HandleListTransactions(state, getUserID)))
	mux.HandleFunc("POST /api/v1/transactions", NewHandler(HandleCreateTransaction(state, getUserID)))
	mux.HandleFunc("POST /api/v1/transactions/categorize", NewHandler(HandleBulkCategorize(state, getUserID)))
	mux.HandleFunc("PATCH /api/v1/transactions/{id}", NewHandler(HandleUpdateTransaction(state, getUserID)))
	mux.HandleFunc("DELETE /api/v1/transactions/{id}", NewHandler(HandleDeleteTransaction(state, getUserID)))

	mux.HandleFunc("GET /api/v1/balances", NewHandler(HandleGetBalances(state, getUserID)))

	mux.HandleFunc("GET /api/v1/inbox", NewHandler(HandleListInbox(state, getUserID)))
	mux.HandleFunc("POST /api/v1/inbox/categorize", NewHandler(HandleCategorizeInbox(state, getUserID)))
	mux.HandleFunc("GET /api/v1/inbox/{id}/transfer-matches", NewHandler(HandleGetTransferMatches(state, getUserID)))
	mux.HandleFunc("POST /api/v1/inbox/{id}/match-transfer", NewHandler(HandleMatchInboxTransfer(state, getUserID)))

	mux.HandleFunc("POST /api/v1/imports", NewHandler(HandleCreateImport(state, getUserID)))
	mux.HandleFunc("GET /api/v1/imports", NewHandler(HandleListImports(state, getUserID)))
	mux.HandleFunc("GET /api/v1/imports/{id}", NewHandler(HandleGetImport(state, getUserID)))
	mux.HandleFunc("GET /api/v1/imports/{id}/duplicates", NewHandler(HandleListDuplicates(state, getUserID)))
	mux.HandleFunc("POST /api/v1/imports/rows/{id}/import", NewHandler(HandleForceImportRow(state, getUserID)))
	mux.HandleFunc("DELETE /api/v1/imports/{id}", NewHandler(HandleDeleteImport(state, getUserID)))

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.Handle("/", FrontendHandler(state, dist))

	// middleware chain (outermost first)
	var handler http.Handler = mux
	// CORS is only needed when the frontend is served from a different origin.
	if state.Config.FrontUrl != "" {
		handler = Cors(state.Config.FrontUrl)(handler)
	}
	handler = Logger(handler)
	handler = RequestID(handler)

	return handler
}

type req_ctx_key string

const REQ_ID_KEY req_ctx_key = "req_id"

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*r = *r.WithContext(context.WithValue(r.Context(), REQ_ID_KEY, data.NewPrivateID()))
		next.ServeHTTP(w, r)
	})
}

func GetRequestID(r *http.Request) string {
	id, _ := r.Context().Value(REQ_ID_KEY).(string)
	return id
}

func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip frontend/proxy traffic (static assets, Vite HMR) — only log the API.
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		reqID := GetRequestID(r)

		slog.LogAttrs(r.Context(), slog.LevelInfo, "rs",
			slog.String("req_id", reqID),
			slog.String("path", r.URL.Path),
			slog.String("method", r.Method),
		)

		start := time.Now()
		next.ServeHTTP(w, r)
		took := time.Since(start).Microseconds()
		millis := strconv.FormatFloat(float64(took)/1000.0, 'f', 2, 64) + "ms"

		slog.LogAttrs(r.Context(), slog.LevelInfo, "re",
			slog.String("req_id", reqID),
			slog.String("took", millis),
		)
	})
}

func Cors(frontUrl string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", frontUrl)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, Cookie")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

var invalidAuth = NewErr("invalid auth", http.StatusUnauthorized)

func Authenticate(state *state.State, r *http.Request) (*AuthInfo, error) {
	cookie, err := r.Cookie(auth.CookieName)
	if err != nil {
		return nil, invalidAuth
	}

	session, err := state.Data.GetSessionByTokenHash(r.Context(), auth.HashToken(cookie.Value))
	if err != nil {
		return nil, NewUnexpectedErr("error getting session: %w", err)
	}
	if session == nil {
		return nil, invalidAuth
	}

	return &AuthInfo{
		UserID:    session.UserID,
		SessionID: session.ID,
	}, nil
}

func GetUserIDMiddleware(state *state.State) GetUserID {
	return func(r *http.Request) (string, error) {
		info, err := Authenticate(state, r)
		if err != nil {
			return "", err
		}
		return info.UserID, nil
	}
}

type GetUserID func(r *http.Request) (string, error)

type AuthInfo struct {
	UserID    string
	SessionID string
}

type ApiError struct {
	messageToResponse string
	messageToLog      string
	httpStatus        int
	details           interface{}
}

func (e *ApiError) Error() string {
	return e.messageToLog
}

type Handler func(w http.ResponseWriter, r *http.Request) error

func NewHandler(handler Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := handler(w, r); err != nil {
			reqID := GetRequestID(r)

			apiErr, ok := err.(*ApiError)
			if !ok {
				apiErr = NewUnexpectedErr("unexpected error: %w", err).(*ApiError)
			}

			slog.Error(apiErr.messageToLog, "req_id", reqID)

			w.Header().Set("content-type", "application/json")
			w.WriteHeader(apiErr.httpStatus)
			json.NewEncoder(w).Encode(JSON{
				"error":   apiErr.messageToResponse,
				"details": apiErr.details,
			})
		}
	}
}

type JSON map[string]interface{}

func NewErr(msg string, httpStatus int) error {
	return &ApiError{messageToResponse: msg, messageToLog: msg, httpStatus: httpStatus}
}

func NewUnexpectedErr(format string, o ...any) error {
	return &ApiError{
		messageToResponse: "unexpected server error",
		messageToLog:      fmt.Errorf(format, o...).Error(),
		httpStatus:        http.StatusInternalServerError,
	}
}

func NewErrWithDetails(msg string, details interface{}, httpStatus int) error {
	return &ApiError{
		messageToResponse: msg,
		messageToLog:      msg,
		httpStatus:        httpStatus,
		details:           details,
	}
}

func Json(w http.ResponseWriter, data interface{}) {
	JsonStatus(w, http.StatusOK, data)
}

func JsonStatus(w http.ResponseWriter, statusCode int, data interface{}) {
	text, _ := json.Marshal(data)

	w.Header().Set("content-type", "application/json")
	w.WriteHeader(statusCode)
	w.Write(text)
}
