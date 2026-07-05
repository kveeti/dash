package data

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDiskFileStore(t *testing.T) {
	store, err := NewDiskFileStore(t.TempDir())
	require.NoError(t, err)
	ctx := context.Background()

	require.NoError(t, store.Put(ctx, "k1", strings.NewReader("hello world")))

	rc, err := store.Open(ctx, "k1")
	require.NoError(t, err)
	b, err := io.ReadAll(rc)
	require.NoError(t, rc.Close())
	require.NoError(t, err)
	require.Equal(t, "hello world", string(b))

	require.NoError(t, store.Delete(ctx, "k1"))
	_, err = store.Open(ctx, "k1")
	require.ErrorIs(t, err, ErrFileNotFound)

	require.NoError(t, store.Delete(ctx, "k1")) // idempotent
}
