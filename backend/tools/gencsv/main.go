package main

import (
	"bufio"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"time"
)

// Generates a Nordea-format CSV of random transactions for load-testing the importer.
// Layout matches data.NordeaParser: date;amount;;;;payee(Otsikko);message;reference;;currency
// Usage: go run . -n 2000000 -o transactions.csv

var currencies = []string{"EUR", "EUR", "EUR", "EUR", "USD", "GBP", "SEK"}

var payees = []string{
	"K-Market", "Prisma", "Lidl", "Alepa", "S-Market", "R-Kioski", "Wolt",
	"Spotify", "Netflix", "HSL", "Neste", "St1", "Amazon", "Verkkokauppa",
	"Clas Ohlson", "IKEA", "Ravintola Savoy", "McDonalds", "Hesburger",
	"Apteekki", "Alko", "Gigantti", "Power", "Stockmann", "Fazer",
}

var messages = []string{
	"", "", "", "Kortti­maksu", "Verkkopankki", "Tilisiirto",
	"Kuukausimaksu", "Palautus", "Lasku", "Ostos",
}

func main() {
	n := flag.Int("n", 2_000_000, "number of rows")
	out := flag.String("o", "transactions.csv", "output file")
	dupRate := flag.Float64("dup", 0.05, "fraction of rows that are exact duplicates of the previous row")
	flag.Parse()

	f, err := os.Create(*out)
	if err != nil {
		panic(err)
	}
	defer f.Close()

	w := bufio.NewWriterSize(f, 1<<20)
	defer w.Flush()

	fmt.Fprint(w, "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;\n")

	rng := rand.New(rand.NewSource(42))
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

	var prev string
	for i := 0; i < *n; i++ {
		if prev != "" && rng.Float64() < *dupRate {
			w.WriteString(prev)
			continue
		}

		date := start.AddDate(0, 0, rng.Intn(2000)).Format("2006/01/02")
		euros := rng.Intn(500)
		cents := rng.Intn(100)
		sign := "-"
		if rng.Intn(10) == 0 {
			sign = ""
		}
		amount := fmt.Sprintf("%s%d,%02d", sign, euros, cents)
		payee := payees[rng.Intn(len(payees))]
		message := messages[rng.Intn(len(messages))]
		ref := ""
		if rng.Intn(4) == 0 {
			ref = fmt.Sprintf("%d", 1000000+rng.Intn(9000000))
		}
		currency := currencies[rng.Intn(len(currencies))]

		prev = fmt.Sprintf("%s;%s;;;;%s;%s;%s;;%s\n",
			date, amount, payee, message, ref, currency)
		w.WriteString(prev)
	}

	fmt.Fprintf(os.Stderr, "wrote %d rows to %s\n", *n, *out)
}
