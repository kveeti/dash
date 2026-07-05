package data

import (
	"github.com/google/uuid"
	"github.com/jaevor/go-nanoid"
)

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"

var newPublicID, _ = nanoid.CustomASCII(alphabet, 16)

func NewPrivateID() string {
	return uuid.Must(uuid.NewV7()).String()
}
