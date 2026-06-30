package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// RandomString returns a URL-safe random string with 32 bytes of entropy.
func RandomString() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// NewSessionToken returns a random opaque token to put in the cookie and the
// hash to store in the database. Only the hash is persisted, so a database
// leak does not expose usable session tokens.
func NewSessionToken() (raw, hash string, err error) {
	raw, err = RandomString()
	if err != nil {
		return "", "", err
	}
	return raw, HashToken(raw), nil
}

// HashToken hashes a raw session token for storage and lookup.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
