CREATE TABLE snapshots (
    sync_id    TEXT PRIMARY KEY,
    version    BIGINT NOT NULL,
    data       BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
