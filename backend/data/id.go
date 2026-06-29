package data

import "github.com/jaevor/go-nanoid"

var alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
var newID, _ = nanoid.CustomASCII(alphabet, 18)

func NewID() string {
	return newID()
}

func NewUserID() string {
	return "usr_" + newID()
}

func NewSessionID() string {
	return "ses_" + newID()
}

func NewRequestID() string {
	return "req_" + newID()
}
