package state

import (
	"money/backend/auth"
	"money/backend/config"
	"money/backend/data"
	"money/backend/enablebanking"
)

type State struct {
	Data                *data.Data
	Config              *config.Config
	OIDC                *auth.OIDC
	EnableBankingClient *enablebanking.Client
	EnableBankingSyncer *enablebanking.Syncer
}

func NewState(d *data.Data, c *config.Config, o *auth.OIDC) *State {
	return &State{
		Data:   d,
		Config: c,
		OIDC:   o,
	}
}
