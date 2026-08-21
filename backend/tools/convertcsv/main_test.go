package main

import (
	"bytes"
	"encoding/csv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConvertPreservesAmountSigns(t *testing.T) {
	input := `"Kirjauspäivä";"Arvopäivä";"Määrä EUROA";"Laji";"Selitys";"Saaja/Maksaja";"Saajan tilinumero";"Saajan pankin BIC";"Viite";"Viesti";"Arkistointitunnus"
"2020-06-09";"2020-06-09";-4,00;"162";"PKORTTIMAKSU";"Cafe";"";"";"ref=";"Card payment";"id-1"
"2020-06-10";"2020-06-10";39,00;"110";"PANO";"Friend";"";"";"ref=123";"";"id-2"
`
	var output bytes.Buffer
	require.NoError(t, convert(strings.NewReader(input), &output))

	rows, err := csv.NewReader(&output).ReadAll()
	require.NoError(t, err)
	require.Equal(t, [][]string{
		{"date", "occurred_at", "amount", "currency", "counterparty", "note"},
		{"2020-06-09", "", "-4.00", "EUR", "Cafe", "PKORTTIMAKSU | Card payment"},
		{"2020-06-10", "", "39.00", "EUR", "Friend", "PANO | 123"},
	}, rows)
}

func TestConvertRejectsInvalidAmount(t *testing.T) {
	input := `"Kirjauspäivä";"Arvopäivä";"Määrä EUROA";"Laji";"Selitys";"Saaja/Maksaja";"Saajan tilinumero";"Saajan pankin BIC";"Viite";"Viesti";"Arkistointitunnus"
"2020-06-09";"2020-06-09";4.00;"162";"PKORTTIMAKSU";"Cafe";"";"";"ref=";"";"id-1"
`
	var output bytes.Buffer
	err := convert(strings.NewReader(input), &output)
	require.EqualError(t, err, `line 2: invalid amount "4.00"`)
}
