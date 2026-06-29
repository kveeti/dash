package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const dataSplitter = "."
const signatureSplitter = ":"

type Token struct {
	UserID    string
	SessionID string
}

func CreateToken(secret, userID, sessionID string, expiry time.Time) string {
	data := userID + dataSplitter + sessionID + dataSplitter + strconv.FormatInt(expiry.UTC().UnixMilli(), 10)
	signature := createSignature(secret, data)

	return data + signatureSplitter + signature
}

func ValidateToken(secret, token string) (*Token, error) {
	dataAndSignature := strings.Split(token, signatureSplitter)
	if len(dataAndSignature) != 2 {
		return nil, fmt.Errorf("invalid token")
	}

	data := dataAndSignature[0]
	signature := dataAndSignature[1]

	expectedSignature := createSignature(secret, data)
	if subtle.ConstantTimeCompare([]byte(signature), []byte(expectedSignature)) != 1 {
		return nil, fmt.Errorf("invalid signature")
	}

	dataSplit := strings.Split(data, dataSplitter)
	if len(dataSplit) != 3 {
		return nil, fmt.Errorf("invalid token")
	}

	expiry, err := strconv.ParseInt(dataSplit[2], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("error parsing expiry: %w", err)
	}

	if time.Now().UTC().UnixMilli() > expiry {
		return nil, fmt.Errorf("token expired")
	}

	return &Token{
		UserID:    dataSplit[0],
		SessionID: dataSplit[1],
	}, nil
}

func createSignature(secret, data string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))

	return base64.URLEncoding.EncodeToString(mac.Sum(nil))
}
