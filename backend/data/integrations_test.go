package data

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidIBAN(t *testing.T) {
	require.Equal(t, "FI2112345600000785", NormalizeIBAN("fi21 1234 5600 0007 85"))
	require.True(t, ValidIBAN("FI21 1234 5600 0007 85"))
	require.False(t, ValidIBAN("FI21 1234 5600 0007 86"))
	require.False(t, ValidIBAN("not-an-iban"))
}
