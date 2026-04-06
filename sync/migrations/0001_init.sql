CREATE TABLE changesets (
    sync_id    TEXT NOT NULL,
    version    BIGINT GENERATED ALWAYS AS IDENTITY,
    data       BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sync_id, version)
);

CREATE INDEX idx_changesets_lookup ON changesets (sync_id, version);
