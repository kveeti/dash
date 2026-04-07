CREATE TABLE identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_hash TEXT NOT NULL,
    server_salt TEXT NOT NULL,
    encrypted_dek TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
