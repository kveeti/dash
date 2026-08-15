package data

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidatePostingsRejectsOverflowedTotal(t *testing.T) {
	postings := []Posting{
		{Amount: math.MaxInt64, Currency: "EUR"},
		{Amount: math.MaxInt64, Currency: "EUR"},
		{Amount: 2, Currency: "EUR"},
	}

	require.ErrorIs(t, validatePostings(postings), ErrUnbalanced)
}

func TestValidatePostingsAcceptsExactExtremeTotal(t *testing.T) {
	postings := []Posting{
		{Amount: math.MaxInt64, Currency: "EUR"},
		{Amount: math.MinInt64, Currency: "EUR"},
		{Amount: 1, Currency: "EUR"},
	}

	require.NoError(t, validatePostings(postings))
}
