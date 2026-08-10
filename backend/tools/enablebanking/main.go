// Command enablebanking captures raw account data from the real Enable Banking API.
package main

import (
	"bufio"
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultAPIOrigin = "https://api.enablebanking.com"
	maxResponseBytes = 64 << 20
)

type options struct {
	appID, keyPath, bank, country, psuType string
	redirectURL, dateFrom, dateTo, status  string
	outPath                                string
}

type responseCapture struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

type accountCapture struct {
	UID              string            `json:"uid,omitempty"`
	SessionAccount   json.RawMessage   `json:"session_account"`
	Details          responseCapture   `json:"details"`
	Balances         responseCapture   `json:"balances"`
	TransactionPages []responseCapture `json:"transaction_pages"`
}

type capture struct {
	CapturedAt    time.Time        `json:"captured_at"`
	APIOrigin     string           `json:"api_origin"`
	Bank          string           `json:"bank"`
	Country       string           `json:"country"`
	PSUType       string           `json:"psu_type"`
	DateFrom      string           `json:"date_from"`
	DateTo        string           `json:"date_to"`
	Status        string           `json:"transaction_status,omitempty"`
	Application   responseCapture  `json:"application"`
	ASPSP         json.RawMessage  `json:"aspsp"`
	Authorization responseCapture  `json:"authorization"`
	Session       responseCapture  `json:"session"`
	SessionData   responseCapture  `json:"session_data"`
	Accounts      []accountCapture `json:"accounts"`
	Errors        []string         `json:"errors,omitempty"`
}

type apiClient struct {
	origin string
	appID  string
	key    *rsa.PrivateKey
	http   *http.Client
	now    func() time.Time
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "enablebanking:", err)
		os.Exit(1)
	}
}

func run() error {
	now := time.Now().UTC()
	opts := options{}
	flag.StringVar(&opts.appID, "app-id", os.Getenv("ENABLEBANKING_APP_ID"), "Enable Banking application ID (or ENABLEBANKING_APP_ID)")
	flag.StringVar(&opts.keyPath, "key", os.Getenv("ENABLEBANKING_PRIVATE_KEY"), "RSA private key PEM path (or ENABLEBANKING_PRIVATE_KEY)")
	flag.StringVar(&opts.bank, "bank", "", "Enable Banking ASPSP name, for example Revolut")
	flag.StringVar(&opts.country, "country", "", "two-letter ASPSP country, for example FI")
	flag.StringVar(&opts.psuType, "psu-type", "personal", "PSU type: personal or business")
	flag.StringVar(&opts.redirectURL, "redirect-url", "", "registered redirect URL; defaults to the application's first URL")
	flag.StringVar(&opts.dateFrom, "from", now.AddDate(0, 0, -90).Format(time.DateOnly), "first transaction date, inclusive")
	flag.StringVar(&opts.dateTo, "to", now.Format(time.DateOnly), "last transaction date, inclusive")
	flag.StringVar(&opts.status, "status", "BOOK", "transaction status filter; empty fetches every status")
	flag.StringVar(&opts.outPath, "out", "", "output JSON path (required; contains private bank data)")
	flag.Parse()

	if err := validateOptions(opts); err != nil {
		return err
	}
	keyPEM, err := os.ReadFile(opts.keyPath)
	if err != nil {
		return fmt.Errorf("read private key: %w", err)
	}
	key, err := parseRSAPrivateKey(keyPEM)
	if err != nil {
		return err
	}

	client := &apiClient{
		origin: defaultAPIOrigin,
		appID:  opts.appID,
		key:    key,
		http:   &http.Client{Timeout: 90 * time.Second},
		now:    time.Now,
	}
	result, err := collect(client, opts, bufio.NewReader(os.Stdin), os.Stdout)
	if err != nil {
		return err
	}
	if err := writeCapture(opts.outPath, result); err != nil {
		return err
	}
	fmt.Fprintf(os.Stdout, "Saved raw API responses to %s\n", opts.outPath)
	return nil
}

func validateOptions(opts options) error {
	var missing []string
	for _, required := range []struct{ name, value string }{
		{"-app-id", opts.appID},
		{"-key", opts.keyPath},
		{"-bank", opts.bank},
		{"-country", opts.country},
		{"-out", opts.outPath},
	} {
		if strings.TrimSpace(required.value) == "" {
			missing = append(missing, required.name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("required flags not set: %s", strings.Join(missing, ", "))
	}
	if len(opts.country) != 2 || strings.ToUpper(opts.country) != opts.country {
		return errors.New("-country must be a two-letter uppercase code")
	}
	if opts.psuType != "personal" && opts.psuType != "business" {
		return errors.New("-psu-type must be personal or business")
	}
	from, err := time.Parse(time.DateOnly, opts.dateFrom)
	if err != nil {
		return errors.New("-from must use YYYY-MM-DD")
	}
	to, err := time.Parse(time.DateOnly, opts.dateTo)
	if err != nil {
		return errors.New("-to must use YYYY-MM-DD")
	}
	if from.After(to) {
		return errors.New("-from must not be after -to")
	}
	return nil
}

func collect(client *apiClient, opts options, input *bufio.Reader, output io.Writer) (*capture, error) {
	result := &capture{
		CapturedAt: client.now().UTC(), APIOrigin: client.origin,
		Bank: opts.bank, Country: opts.country, PSUType: opts.psuType,
		DateFrom: opts.dateFrom, DateTo: opts.dateTo, Status: opts.status,
	}

	application, err := client.request(http.MethodGet, "/application", nil, nil)
	if err != nil {
		return nil, err
	}
	result.Application = application
	if err := requireOK("get application", application); err != nil {
		return nil, err
	}
	var app struct {
		RedirectURLs []string `json:"redirect_urls"`
	}
	if err := json.Unmarshal(application.Body, &app); err != nil {
		return nil, fmt.Errorf("decode application: %w", err)
	}
	redirectURL := opts.redirectURL
	if redirectURL == "" {
		if len(app.RedirectURLs) == 0 {
			return nil, errors.New("application has no redirect URLs; pass -redirect-url")
		}
		redirectURL = app.RedirectURLs[0]
	}

	aspsps, err := client.request(http.MethodGet, "/aspsps", url.Values{
		"country":  {opts.country},
		"psu_type": {opts.psuType},
		"service":  {"AIS"},
	}, nil)
	if err != nil {
		return nil, err
	}
	if err := requireOK("get ASPSPs", aspsps); err != nil {
		return nil, err
	}
	selected, maxValidity, err := selectASPSP(aspsps.Body, opts.bank, opts.country)
	if err != nil {
		return nil, err
	}
	result.ASPSP = selected

	state, err := randomState()
	if err != nil {
		return nil, err
	}
	validity := time.Duration(maxValidity) * time.Second
	if validity > time.Minute {
		validity -= time.Minute
	}
	authBody := map[string]any{
		"access": map[string]any{
			"balances":     true,
			"transactions": true,
			"valid_until":  client.now().UTC().Add(validity).Format(time.RFC3339),
		},
		"aspsp":        map[string]string{"name": opts.bank, "country": opts.country},
		"state":        state,
		"redirect_url": redirectURL,
		"psu_type":     opts.psuType,
	}
	authorization, err := client.request(http.MethodPost, "/auth", nil, authBody)
	if err != nil {
		return nil, err
	}
	result.Authorization = authorization
	if err := requireOK("start authorization", authorization); err != nil {
		return nil, err
	}
	var auth struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(authorization.Body, &auth); err != nil {
		return nil, fmt.Errorf("decode authorization: %w", err)
	}
	if auth.URL == "" {
		return nil, errors.New("authorization response has no URL")
	}
	fmt.Fprintf(output, "\nOpen this URL and complete bank authorization:\n\n%s\n\n", auth.URL)
	fmt.Fprint(output, "Paste the full redirected URL here: ")
	redirected, err := input.ReadString('\n')
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("read redirected URL: %w", err)
	}
	code, err := authorizationCode(strings.TrimSpace(redirected), state)
	if err != nil {
		return nil, err
	}

	session, err := client.request(http.MethodPost, "/sessions", nil, map[string]string{"code": code})
	if err != nil {
		return nil, err
	}
	result.Session = session
	if err := requireOK("create session", session); err != nil {
		return nil, err
	}
	var sessionBody struct {
		SessionID string            `json:"session_id"`
		Accounts  []json.RawMessage `json:"accounts"`
	}
	if err := json.Unmarshal(session.Body, &sessionBody); err != nil {
		return nil, fmt.Errorf("decode session: %w", err)
	}
	if sessionBody.SessionID == "" {
		return nil, errors.New("session response has no session_id")
	}

	sessionData, err := client.request(http.MethodGet, "/sessions/"+url.PathEscape(sessionBody.SessionID), nil, nil)
	if err != nil {
		return nil, err
	}
	result.SessionData = sessionData
	if sessionData.Status < 200 || sessionData.Status >= 300 {
		result.Errors = append(result.Errors, responseError("get session data", sessionData))
	}

	for _, rawAccount := range sessionBody.Accounts {
		account := accountCapture{SessionAccount: rawAccount}
		var a struct {
			UID string `json:"uid"`
		}
		if err := json.Unmarshal(rawAccount, &a); err != nil {
			result.Errors = append(result.Errors, "decode session account: "+err.Error())
			result.Accounts = append(result.Accounts, account)
			continue
		}
		account.UID = a.UID
		if a.UID == "" {
			result.Errors = append(result.Errors, "session account has no uid; data was not fetched")
			result.Accounts = append(result.Accounts, account)
			continue
		}

		path := "/accounts/" + url.PathEscape(a.UID)
		account.Details, err = client.request(http.MethodGet, path+"/details", nil, nil)
		if err != nil {
			return nil, err
		}
		if account.Details.Status < 200 || account.Details.Status >= 300 {
			result.Errors = append(result.Errors, responseError("get account "+a.UID+" details", account.Details))
		}
		account.Balances, err = client.request(http.MethodGet, path+"/balances", nil, nil)
		if err != nil {
			return nil, err
		}
		if account.Balances.Status < 200 || account.Balances.Status >= 300 {
			result.Errors = append(result.Errors, responseError("get account "+a.UID+" balances", account.Balances))
		}

		query := url.Values{"date_from": {opts.dateFrom}, "date_to": {opts.dateTo}}
		if opts.status != "" {
			query.Set("transaction_status", opts.status)
		}
		seenKeys := map[string]bool{}
		for {
			page, requestErr := client.request(http.MethodGet, path+"/transactions", query, nil)
			if requestErr != nil {
				return nil, requestErr
			}
			account.TransactionPages = append(account.TransactionPages, page)
			if page.Status < 200 || page.Status >= 300 {
				result.Errors = append(result.Errors, responseError("get account "+a.UID+" transactions", page))
				break
			}
			var body struct {
				ContinuationKey string `json:"continuation_key"`
			}
			if err := json.Unmarshal(page.Body, &body); err != nil {
				result.Errors = append(result.Errors, "decode account "+a.UID+" transactions: "+err.Error())
				break
			}
			if body.ContinuationKey == "" {
				break
			}
			if seenKeys[body.ContinuationKey] {
				result.Errors = append(result.Errors, "account "+a.UID+" returned a repeated continuation key")
				break
			}
			seenKeys[body.ContinuationKey] = true
			query.Set("continuation_key", body.ContinuationKey)
		}
		result.Accounts = append(result.Accounts, account)
	}
	return result, nil
}

func (c *apiClient) request(method, path string, query url.Values, body any) (responseCapture, error) {
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return responseCapture{}, err
		}
		requestBody = bytes.NewReader(encoded)
	}
	u := c.origin + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest(method, u, requestBody)
	if err != nil {
		return responseCapture{}, err
	}
	token, err := signJWT(c.appID, c.key, c.now())
	if err != nil {
		return responseCapture{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return responseCapture{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return responseCapture{}, err
	}
	if len(raw) > maxResponseBytes {
		return responseCapture{}, fmt.Errorf("%s %s response exceeds %d bytes", method, path, maxResponseBytes)
	}
	if !json.Valid(raw) {
		return responseCapture{}, fmt.Errorf("%s %s returned non-JSON response with status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return responseCapture{Status: resp.StatusCode, Body: json.RawMessage(raw)}, nil
}

func requireOK(action string, response responseCapture) error {
	if response.Status >= 200 && response.Status < 300 {
		return nil
	}
	return errors.New(responseError(action, response))
}

func responseError(action string, response responseCapture) string {
	return fmt.Sprintf("%s failed with status %d: %s", action, response.Status, strings.TrimSpace(string(response.Body)))
}

func selectASPSP(raw json.RawMessage, name, country string) (json.RawMessage, int64, error) {
	var body struct {
		ASPSPs []json.RawMessage `json:"aspsps"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, 0, fmt.Errorf("decode ASPSPs: %w", err)
	}
	for _, item := range body.ASPSPs {
		var aspsp struct {
			Name                   string `json:"name"`
			Country                string `json:"country"`
			MaximumConsentValidity int64  `json:"maximum_consent_validity"`
		}
		if err := json.Unmarshal(item, &aspsp); err != nil {
			return nil, 0, fmt.Errorf("decode ASPSP: %w", err)
		}
		if aspsp.Name == name && aspsp.Country == country {
			if aspsp.MaximumConsentValidity <= 0 {
				return nil, 0, fmt.Errorf("ASPSP %s %s has invalid maximum consent validity", country, name)
			}
			return item, aspsp.MaximumConsentValidity, nil
		}
	}
	return nil, 0, fmt.Errorf("ASPSP %s %s was not returned by Enable Banking", country, name)
}

func authorizationCode(redirectedURL, expectedState string) (string, error) {
	u, err := url.Parse(redirectedURL)
	if err != nil {
		return "", fmt.Errorf("parse redirected URL: %w", err)
	}
	query := u.Query()
	if query.Get("state") != expectedState {
		return "", errors.New("redirected URL has the wrong state")
	}
	if apiErr := query.Get("error"); apiErr != "" {
		return "", fmt.Errorf("authorization failed: %s: %s", apiErr, query.Get("error_description"))
	}
	if code := query.Get("code"); code != "" {
		return code, nil
	}
	return "", errors.New("redirected URL has no authorization code")
}

func randomState() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func parseRSAPrivateKey(raw []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("private key is not PEM encoded")
	}
	if x509.IsEncryptedPEMBlock(block) {
		return nil, errors.New("encrypted private keys are not supported")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("private key is neither PKCS#1 nor PKCS#8 RSA")
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not RSA")
	}
	return key, nil
}

func signJWT(appID string, key *rsa.PrivateKey, now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"typ": "JWT", "alg": "RS256", "kid": appID})
	if err != nil {
		return "", err
	}
	issued := now.UTC().Unix()
	claims, err := json.Marshal(map[string]any{
		"iss": "enablebanking.com",
		"aud": "api.enablebanking.com",
		"iat": issued,
		"exp": issued + 300,
	})
	if err != nil {
		return "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	unsigned := encode(header) + "." + encode(claims)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}
	return unsigned + "." + encode(signature), nil
}

func writeCapture(path string, value *capture) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".enablebanking-*.json")
	if err != nil {
		return fmt.Errorf("create output: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("protect output: %w", err)
	}
	encoder := json.NewEncoder(tmp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		tmp.Close()
		return fmt.Errorf("write output: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close output: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("save output: %w", err)
	}
	return nil
}
