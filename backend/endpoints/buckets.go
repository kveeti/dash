package endpoints

import (
	"encoding/json"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"strings"
	"time"
)

// userCreatableKinds are the bucket kinds a user may create directly.
var userCreatableKinds = map[data.BucketKind]bool{
	data.KindAsset:     true,
	data.KindLiability: true,
	data.KindExpense:   true,
	data.KindIncome:    true,
	data.KindPerson:    true,
}

type bucketResponse struct {
	ID       string          `json:"id"`
	Kind     data.BucketKind `json:"kind"`
	Name     string          `json:"name"`
	ParentID *string         `json:"parent_id"`
	Hidden   bool            `json:"hidden"`
}

func toBucketResponse(b data.Bucket) bucketResponse {
	return bucketResponse{ID: b.ID, Kind: b.Kind, Name: b.Name, ParentID: b.ParentID, Hidden: b.Hidden}
}

func HandleListBuckets(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		var buckets []data.Bucket
		if _, searched := r.URL.Query()["q"]; searched {
			values := r.URL.Query()["kind"]
			kinds := make([]data.BucketKind, len(values))
			for i, value := range values {
				kinds[i] = data.BucketKind(value)
			}
			buckets, err = state.Data.SearchBuckets(
				r.Context(),
				userID,
				strings.TrimSpace(r.URL.Query().Get("q")),
				kinds,
			)
		} else {
			buckets, err = state.Data.ListBuckets(r.Context(), userID)
		}
		if err != nil {
			return NewUnexpectedErr("error listing buckets: %w", err)
		}

		out := make([]bucketResponse, len(buckets))
		for i, b := range buckets {
			out[i] = toBucketResponse(b)
		}
		Json(w, out)
		return nil
	}
}

func HandleCreateBucket(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		var body struct {
			Kind     data.BucketKind `json:"kind"`
			Name     string          `json:"name"`
			ParentID *string         `json:"parent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		if !userCreatableKinds[body.Kind] {
			return NewErr("invalid bucket kind", http.StatusBadRequest)
		}
		if body.Name == "" {
			return NewErr("name is required", http.StatusBadRequest)
		}

		bucket := data.Bucket{
			ID:          data.NewPrivateID(),
			OwnerUserID: userID,
			Kind:        body.Kind,
			Name:        body.Name,
			ParentID:    body.ParentID,
			CreatedAt:   time.Now(),
		}
		if err := state.Data.CreateBucket(r.Context(), bucket); err != nil {
			return NewUnexpectedErr("error creating bucket: %w", err)
		}

		JsonStatus(w, http.StatusCreated, toBucketResponse(bucket))
		return nil
	}
}
