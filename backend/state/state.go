package state

import (
	"money/backend/config"
	"money/backend/data"
)

type State struct {
	Data   *data.Data
	Config *config.Config
}

func NewState(d *data.Data, c *config.Config) *State {
	return &State{
		Data:   d,
		Config: c,
	}
}
