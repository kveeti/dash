package endpoints

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"

	"money/backend/data"

	"github.com/stretchr/testify/require"
)

const (
	nordeaHeader  = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;\n"
	opHeader      = "\"Kirjauspäivä\";\"Arvopäivä\";\"Määrä EUROA\";\"Laji\";\"Selitys\";\"Saaja/Maksaja\";\"Saajan tilinumero\";\"Saajan pankin BIC\";\"Viite\";\"Viesti\";\"Arkistointitunnus\"\n"
	revolutHeader = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n"
)

func nordeaRow(date, amount, payee, message string) string {
	return nordeaRowCurrency(date, amount, payee, message, "EUR")
}

func nordeaRowCurrency(date, amount, payee, message, currency string) string {
	return date + ";" + amount + ";;;;" + payee + ";" + message + ";;;" + currency + "\n"
}

// nordeaRowBal is nordeaRow with a running balance in the Saldo column (col 8),
// which folds into the dedup fingerprint.
func nordeaRowBal(date, amount, payee, message, balance string) string {
	return date + ";" + amount + ";;;;" + payee + ";" + message + ";;" + balance + ";EUR\n"
}

func importCSV(t *testing.T, app *testApp, bucketID, csv string) *http.Response {
	t.Helper()
	return importCSVFormat(t, app, bucketID, "nordea", csv)
}

func importCSVFormat(t *testing.T, app *testApp, bucketID, format, csv string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	require.NoError(t, mw.WriteField("bucket_id", bucketID))
	require.NoError(t, mw.WriteField("format", format))
	if format != "revolut" {
		require.NoError(t, mw.WriteField("timezone", "Europe/Helsinki"))
	}
	fw, err := mw.CreateFormFile("file", "export.csv")
	require.NoError(t, err)
	_, err = fw.Write([]byte(csv))
	require.NoError(t, err)
	require.NoError(t, mw.Close())

	req, err := http.NewRequest(http.MethodPost, app.url+"/api/v1/imports", &buf)
	require.NoError(t, err)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.AddCookie(login(t, app))
	resp, err := app.client.Do(req)
	require.NoError(t, err)
	return resp
}

type importResult struct {
	BatchID string `json:"batch_id"`
	Status  string `json:"status"`
}

// doImport uploads a CSV (the request returns as soon as the file is stored) and
// waits for the background worker to promote the batch to done, returning the
// final report.
func doImport(t *testing.T, app *testApp, bucketID, csv string) batchReport {
	t.Helper()
	return doImportFormat(t, app, bucketID, "nordea", csv)
}

func doImportFormat(t *testing.T, app *testApp, bucketID, format, csv string) batchReport {
	t.Helper()
	resp := importCSVFormat(t, app, bucketID, format, csv)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var out importResult
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return waitImport(t, app, out.BatchID)
}

func waitImport(t *testing.T, app *testApp, batchID string) batchReport {
	t.Helper()
	var rep batchReport
	require.Eventually(t, func() bool {
		rep = getBatch(t, app, batchID)
		return rep.Status == "done"
	}, 5*time.Second, 15*time.Millisecond, "import batch never reached done")
	return rep
}

func TestImportNordea(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := nordeaHeader +
		nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries") +
		nordeaRow("2026/07/02", "100,00", "Employer", "Salary")

	res := doImport(t, app, bank, csv)
	require.Equal(t, 2, res.Imported)
	require.Equal(t, 0, res.Duplicates)

	// Import stages rows into the inbox; no transactions exist until categorized.
	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Empty(t, decodeTxns(t, resp))

	byParty := inboxByParty(getInbox(t, app, ""))
	require.Len(t, byParty, 2)
	require.Equal(t, "Groceries", byParty["K-Market"].Description)
	require.Equal(t, int64(-1234), byParty["K-Market"].Amount)
	require.Equal(t, "Salary", byParty["Employer"].Description)
	require.Equal(t, int64(10000), byParty["Employer"].Amount)
}

func TestImportOP(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := opHeader +
		"2026-07-01;2026-07-01;-12,34;Korttimaksu;Ruoka;K-Market;FI123;;;Viesti: Groceries;A1\n" +
		"2026-07-02;2026-07-02;100,00;Tilisiirto;Palkka;Employer;;;;Salary;A2\n"
	res := doImportFormat(t, app, bank, "op", csv)
	require.Equal(t, 2, res.Imported)
	require.Empty(t, res.ParseErrors)

	byParty := inboxByParty(getInbox(t, app, ""))
	require.Equal(t, int64(-1234), byParty["K-Market"].Amount)
	require.Equal(t, "Selitys: Ruoka, Saajan tilinumero: FI123, Viesti: Groceries", byParty["K-Market"].Description)
	require.Equal(t, int64(10000), byParty["Employer"].Amount)
}

func TestImportRevolut(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := revolutHeader +
		"CARD_PAYMENT,Current,2026-07-01 12:30:00,2026-07-01 12:31:00,Cafe,-10.00,0.50,EUR,COMPLETED,90.00\n" +
		"CARD_PAYMENT,Current,2026-07-02 12:30:00,,Pending,-5.00,0,EUR,PENDING,85.00\n"
	res := doImportFormat(t, app, bank, "revolut", csv)
	require.Equal(t, 1, res.Imported)
	require.Empty(t, res.ParseErrors)

	rows := getInbox(t, app, "")
	require.Len(t, rows, 1)
	require.Equal(t, "Cafe", rows[0].Counterparty)
	require.Equal(t, "2026-07-01T12:30:00Z", rows[0].Date)
	require.Equal(t, int64(-1050), rows[0].Amount)
	require.Equal(t, "Type: CARD_PAYMENT, Fee: 0.50", rows[0].Description)
}

func TestImportIdenticalRowsBothImport(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	row := nordeaRow("2026/07/01", "-5,00", "Cafe", "Coffee")
	res := doImport(t, app, bank, nordeaHeader+row+row)
	require.Equal(t, 2, res.Imported)
	require.Equal(t, 0, res.Duplicates)

	require.Len(t, getInbox(t, app, ""), 2)
}

func TestImportDedupsReimport(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := nordeaHeader +
		nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries") +
		nordeaRow("2026/07/02", "100,00", "Employer", "Salary")

	doImport(t, app, bank, csv)
	res := doImport(t, app, bank, csv)
	require.Equal(t, 0, res.Imported)
	require.Equal(t, 2, res.Duplicates)

	// The first import's two rows are still the only inbox items.
	require.Len(t, getInbox(t, app, ""), 2)

	dups := dupRows(t, app, res.ID)
	require.Len(t, dups, 2)
	for _, row := range dups {
		require.NotNil(t, row.DuplicateOf)
		require.NotNil(t, row.Target, "duplicate row exposes its target inline")
		require.Nil(t, row.Target.TransactionID, "target is a pending row, not yet a transaction")
	}
}

func TestForceImportDuplicate(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	row := nordeaRow("2026/07/01", "-5,00", "Cafe", "Coffee")
	doImport(t, app, bank, nordeaHeader+row)        // occ 0 pending
	res := doImport(t, app, bank, nordeaHeader+row) // occ 0 duplicate
	require.Equal(t, 1, res.Duplicates)

	dups := dupRows(t, app, res.ID)
	require.Len(t, dups, 1)
	dupID := dups[0].ID

	resp := authed(t, app, http.MethodPost, "/api/v1/imports/rows/"+dupID+"/import", nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	require.Len(t, getInbox(t, app, ""), 2) // original + forced

	// A third import of the same single-row file dups against both copies.
	res = doImport(t, app, bank, nordeaHeader+row+row)
	require.Equal(t, 0, res.Imported)
	require.Equal(t, 2, res.Duplicates)
}

func TestDeleteImportBatch(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := nordeaHeader + nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries")
	res := doImport(t, app, bank, csv)
	require.Len(t, getInbox(t, app, ""), 1)

	resp := authed(t, app, http.MethodDelete, "/api/v1/imports/"+res.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	require.Empty(t, getInbox(t, app, ""))

	// Dedup memory cleared: re-import works fresh.
	res = doImport(t, app, bank, csv)
	require.Equal(t, 1, res.Imported)
	require.Equal(t, 0, res.Duplicates)
}

func TestDeleteImportRemovesTaggedTransaction(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	batch := doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries"))
	rows := getInbox(t, app, "")
	require.Len(t, rows, 1)
	require.Equal(t, 1, categorizeInbox(t, app, []string{rows[0].ID}, groceries))

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns := decodeTxns(t, resp)
	require.Len(t, txns, 1)
	txnID := txns[0]["id"].(string)
	resp = authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"transaction_ids": []string{txnID}, "tag": "imported",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	resp = authed(t, app, http.MethodDelete, "/api/v1/imports/"+batch.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Empty(t, decodeTxns(t, resp))
	resp = authed(t, app, http.MethodGet, "/api/v1/tags", nil)
	var tags struct {
		Tags []string `json:"tags"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&tags))
	require.Empty(t, tags.Tags)
}

func TestDeleteImportReturnsMatchedRowFromOtherBatchToInbox(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	checkingImport := doImport(t, app, checking, nordeaHeader+nordeaRow("2026/07/01", "-500,00", "Transfer", "Savings"))
	doImport(t, app, savings, nordeaHeader+nordeaRow("2026/07/02", "500,00", "Transfer", "Checking"))

	rows := getInbox(t, app, "")
	require.Len(t, rows, 2)
	var outgoing, incoming string
	for _, row := range rows {
		if row.Amount < 0 {
			outgoing = row.ID
		} else {
			incoming = row.ID
		}
	}
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/"+outgoing+"/match", map[string]any{"match_id": incoming})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, getInbox(t, app, ""))

	resp = authed(t, app, http.MethodDelete, "/api/v1/imports/"+checkingImport.ID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	rows = getInbox(t, app, "")
	require.Len(t, rows, 1)
	require.Equal(t, int64(50000), rows[0].Amount)
	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Empty(t, decodeTxns(t, resp))
}

func TestImportCollectsRowErrors(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := nordeaHeader +
		nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries") +
		nordeaRow("bad-date", "-1,00", "Broken", "x") +
		nordeaRow("2026/07/03", "50,00", "Refund", "y")

	// Parsing is async now, so per-row errors surface on the finished report.
	rep := doImport(t, app, bank, csv)
	require.Equal(t, 2, rep.Imported)
	require.Len(t, rep.ParseErrors, 1)
	require.Equal(t, 3, rep.ParseErrors[0].Line)
}

func TestImportBalanceDisambiguates(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	// Same content, different running balance -> distinct, both import.
	doImport(t, app, bank, nordeaHeader+nordeaRowBal("2026/07/01", "-5,00", "Cafe", "Coffee", "100.00"))
	res := doImport(t, app, bank, nordeaHeader+nordeaRowBal("2026/07/01", "-5,00", "Cafe", "Coffee", "80.00"))
	require.Equal(t, 1, res.Imported)
	require.Equal(t, 0, res.Duplicates)

	require.Len(t, getInbox(t, app, ""), 2)

	// Re-export at the same balance dedups.
	res = doImport(t, app, bank, nordeaHeader+nordeaRowBal("2026/07/01", "-5,00", "Cafe", "Coffee", "80.00"))
	require.Equal(t, 0, res.Imported)
	require.Equal(t, 1, res.Duplicates)
}

func TestImportRejectsNonNordeaFile(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	resp := importCSV(t, app, bank, "date,amount,desc\n2026-07-01,-1,coffee\n")
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestImportRejectsOversizeFile(t *testing.T) {
	old := maxImportBytes
	maxImportBytes = 512
	defer func() { maxImportBytes = old }()

	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	body := nordeaHeader + strings.Repeat(nordeaRow("2026/07/01", "-1,00", "A", "a"), 40)
	resp := importCSV(t, app, bank, body)
	require.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
}

func TestImportRejectsBadBucket(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	groceries := createBucket(t, app, "expense", "Groceries")

	csv := nordeaHeader + nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries")

	resp := importCSV(t, app, groceries, csv)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	resp = importCSV(t, app, "00000000-0000-0000-0000-000000000000", csv)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestListImports(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries"))

	resp := authed(t, app, http.MethodGet, "/api/v1/imports", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var batches []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&batches))
	require.Len(t, batches, 1)
	require.Equal(t, "export.csv", batches[0]["filename"])
	require.Equal(t, float64(1), batches[0]["imported"])
}

// batchReport mirrors the counts-only poll payload — the report endpoint never
// ships rows (they can number in the millions). Row-level detail comes from the
// data layer in tests via dupRows.
type batchReport struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	Imported    int    `json:"imported"`
	Duplicates  int    `json:"duplicates"`
	ParseErrors []struct {
		Line  int    `json:"line"`
		Error string `json:"error"`
	} `json:"parse_errors"`
}

func getBatch(t *testing.T, app *testApp, id string) batchReport {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/imports/"+id, nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out batchReport
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func meID(t *testing.T, app *testApp) string {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/users/@me", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.ID
}

type dupPage struct {
	Rows []struct {
		ID              string  `json:"id"`
		DuplicateOf     *string `json:"duplicate_of"`
		DuplicateTarget *struct {
			TransactionID *string `json:"transaction_id"`
		} `json:"duplicate_target"`
	} `json:"rows"`
	NextCursor *string `json:"next_cursor"`
}

func getDuplicates(t *testing.T, app *testApp, id, query string) dupPage {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/imports/"+id+"/duplicates"+query, nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out dupPage
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func TestListDuplicatesPaginates(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	csv := nordeaHeader +
		nordeaRow("2026/07/01", "-1,00", "A", "a") +
		nordeaRow("2026/07/02", "-2,00", "B", "b") +
		nordeaRow("2026/07/03", "-3,00", "C", "c")

	doImport(t, app, bank, csv)
	res := doImport(t, app, bank, csv)
	require.Equal(t, 3, res.Duplicates)

	p1 := getDuplicates(t, app, res.ID, "?limit=2")
	require.Len(t, p1.Rows, 2)
	require.NotNil(t, p1.NextCursor)
	for _, r := range p1.Rows {
		require.NotNil(t, r.DuplicateOf)
		require.NotNil(t, r.DuplicateTarget, "duplicate row exposes its target inline")
	}

	p2 := getDuplicates(t, app, res.ID, "?limit=2&cursor="+*p1.NextCursor)
	require.Len(t, p2.Rows, 1)
	require.Nil(t, p2.NextCursor)

	require.NotEqual(t, p1.Rows[0].ID, p2.Rows[0].ID)
}

func dupRows(t *testing.T, app *testApp, batchID string) []data.ImportRow {
	t.Helper()
	_, rows, err := app.d.GetImport(context.Background(), meID(t, app), batchID)
	require.NoError(t, err)
	var dups []data.ImportRow
	for _, r := range rows {
		if r.Status == "duplicate" {
			dups = append(dups, r)
		}
	}
	return dups
}
