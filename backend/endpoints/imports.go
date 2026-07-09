package endpoints

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"os"
	"strconv"
	"time"
)

const duplicatesPageSize = 50

// maxImportBytes caps the upload body; a var so tests can lower it.
var maxImportBytes int64 = 64 << 20

func mapImportErr(err error) error {
	switch {
	case errors.Is(err, data.ErrImportNotFound):
		return NewErr(err.Error(), http.StatusNotFound)
	case errors.Is(err, data.ErrImportBucket), errors.Is(err, data.ErrNotDuplicate):
		return NewErr(err.Error(), http.StatusBadRequest)
	default:
		return NewUnexpectedErr("import error: %w", err)
	}
}

// HandleCreateImport lands the upload durably and returns immediately; parsing
// and promotion happen in the background worker. It caps the body, validates the
// bucket, peeks the header to reject a non-Nordea file, then buffers to a temp
// file (so the slow upload holds no DB connection) before storing it.
func HandleCreateImport(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			if isTooLarge(err) {
				return NewErr("file too large", http.StatusRequestEntityTooLarge)
			}
			return NewErr("invalid multipart form", http.StatusBadRequest)
		}
		if r.FormValue("format") != "nordea" {
			return NewErr("unsupported format", http.StatusBadRequest)
		}
		bucketID := r.FormValue("bucket_id")
		if bucketID == "" {
			return NewErr("bucket_id is required", http.StatusBadRequest)
		}
		timezone := r.FormValue("timezone")
		if _, err := time.LoadLocation(timezone); err != nil || timezone == "" {
			return NewErr("valid timezone is required", http.StatusBadRequest)
		}
		if err := state.Data.ValidateImportBucket(r.Context(), userID, bucketID); err != nil {
			return mapImportErr(err)
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			return NewErr("file is required", http.StatusBadRequest)
		}
		defer file.Close()

		br := bufio.NewReader(file)
		firstLine, err := br.ReadString('\n')
		if err != nil && err != io.EOF {
			if isTooLarge(err) {
				return NewErr("file too large", http.StatusRequestEntityTooLarge)
			}
			return NewErr("could not read file", http.StatusBadRequest)
		}
		if !data.ValidNordeaHeader(firstLine) {
			return NewErr("not a Nordea CSV export", http.StatusBadRequest)
		}

		tmp, err := os.CreateTemp("", "import-*.csv")
		if err != nil {
			return NewUnexpectedErr("temp file: %w", err)
		}
		defer os.Remove(tmp.Name())
		defer tmp.Close()

		if _, err := tmp.WriteString(firstLine); err != nil {
			return NewUnexpectedErr("buffering upload: %w", err)
		}
		if _, err := io.Copy(tmp, br); err != nil {
			if isTooLarge(err) {
				return NewErr("file too large", http.StatusRequestEntityTooLarge)
			}
			return NewUnexpectedErr("buffering upload: %w", err)
		}
		if _, err := tmp.Seek(0, io.SeekStart); err != nil {
			return NewUnexpectedErr("temp seek: %w", err)
		}

		batch, err := state.Data.CreateImport(r.Context(), userID, bucketID, "nordea", header.Filename, timezone, tmp)
		if err != nil {
			return mapImportErr(err)
		}

		JsonStatus(w, http.StatusCreated, JSON{
			"batch_id": batch.ID,
			"status":   batch.Status,
		})
		return nil
	}
}

func isTooLarge(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}

func HandleListImports(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		batches, err := state.Data.ListImports(r.Context(), userID)
		if err != nil {
			return NewUnexpectedErr("error listing imports: %w", err)
		}

		out := make([]JSON, len(batches))
		for i, b := range batches {
			out[i] = JSON{
				"id":         b.ID,
				"bucket_id":  b.BucketID,
				"filename":   b.Filename,
				"created_at": b.CreatedAt,
				"status":     b.Status,
				"imported":   b.Imported,
				"duplicates": b.Duplicates,
			}
		}
		Json(w, out)
		return nil
	}
}

func HandleGetImport(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		batch, err := state.Data.GetImportStatus(r.Context(), userID, r.PathValue("id"))
		if err != nil {
			return mapImportErr(err)
		}

		parseErrors := batch.ParseErrors
		if parseErrors == nil {
			parseErrors = json.RawMessage("[]")
		}
		Json(w, JSON{
			"id":           batch.ID,
			"bucket_id":    batch.BucketID,
			"filename":     batch.Filename,
			"created_at":   batch.CreatedAt,
			"status":       batch.Status,
			"imported":     batch.Imported,
			"duplicates":   batch.Duplicates,
			"parse_errors": parseErrors,
		})
		return nil
	}
}

// HandleListDuplicates serves one keyset page of a batch's duplicate rows for the
// report's infinite list. next_cursor is the last id when a full page came back,
// null when the list is exhausted.
func HandleListDuplicates(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		limit := duplicatesPageSize
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		cursor := r.URL.Query().Get("cursor")

		rows, err := state.Data.ListDuplicates(r.Context(), userID, r.PathValue("id"), cursor, limit)
		if err != nil {
			return NewUnexpectedErr("error listing duplicates: %w", err)
		}

		out := make([]JSON, len(rows))
		for i, row := range rows {
			out[i] = JSON{
				"id":              row.ID,
				"date":            formatDate(row.Date),
				"amount":          row.Amount,
				"currency":        row.Currency,
				"raw_description": row.RawDescription,
				"raw":             row.Raw,
				"duplicate_of":    row.DuplicateOf,
			}
			if t := row.Target; t != nil {
				out[i]["duplicate_target"] = JSON{
					"date":            formatDate(t.Date),
					"amount":          t.Amount,
					"currency":        t.Currency,
					"raw_description": t.RawDescription,
					"transaction_id":  t.TransactionID,
					"batch_id":        t.BatchID,
					"created_at":      t.CreatedAt,
				}
			}
		}

		var nextCursor any
		if len(rows) == limit {
			nextCursor = rows[len(rows)-1].ID
		}

		Json(w, JSON{"rows": out, "next_cursor": nextCursor})
		return nil
	}
}

func HandleForceImportRow(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		if err := state.Data.ForceImport(r.Context(), userID, r.PathValue("id")); err != nil {
			return mapImportErr(err)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func HandleDeleteImport(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		if err := state.Data.DeleteImport(r.Context(), userID, r.PathValue("id")); err != nil {
			return mapImportErr(err)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
