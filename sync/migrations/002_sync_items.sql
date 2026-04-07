CREATE TABLE sync_items (
    user_id UUID NOT NULL REFERENCES identities(id),
    item_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    hlc TEXT NOT NULL,
    server_version BIGSERIAL,
    encrypted_blob TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    tombstoned_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, item_id)
);

CREATE INDEX idx_sync_items_pull ON sync_items (user_id, server_version);
