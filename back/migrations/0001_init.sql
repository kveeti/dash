-- users
create table users (
    id text primary key not null,
    external_id text unique,
    auth_public_key text not null,
    _sync_server_version bigint not null default 0
);

-- entries: opaque e2e-encrypted blobs, keyed by (user_id, id).
-- _sync_server_version is assigned from users._sync_server_version at write time
-- (not by a trigger), so that assignment order == broadcast order per user.
create table entries (
    user_id text not null references users(id) on delete cascade,
    id text not null,
    blob bytea not null,

    _sync_is_deleted boolean not null default false,
    _sync_edited_at bigint not null default 0,
    _sync_server_version bigint not null,
    _sync_server_updated_at timestamptz not null default now(),

    primary key (user_id, id)
);

create index idx_server_version on entries(user_id, _sync_server_version asc);

create table sessions (
    id text not null,
    user_id text not null references users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
);

create index idx_sessions_expires_at on sessions(expires_at);
