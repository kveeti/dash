# Sync Issues

## Critical

### 1. All clients share the same HLC node ID `"client-1"`
`react-local/src/providers.tsx:35` — Every browser/device uses the hardcoded
`clientId = "client-1"`. HLCs require unique node IDs for global uniqueness. With the
same node ID, two clients making changes at the same millisecond with the same counter
produce identical HLCs, making the server's `where excluded._sync_hlc > entries._sync_hlc`
check non-deterministic — one client's write silently shadows the other.

### 2. HLC `parse()` breaks on node IDs containing dashes
`react-local/src/lib/hlc.ts:79` — `hlc.split('-')` splits on ALL dashes. Since the node
ID is `"client-1"`, the HLC `000001726749352-00000-client-1` splits into 4 parts:
`["000001726749352", "00000", "client", "1"]`. Destructuring `const [t, c, node]` assigns
`node = "client"`, losing the `-1` suffix. Fixing #1 to use UUIDs (which contain dashes)
would immediately trigger this parsing bug. Fix: use a non-dash delimiter in HLC format,
or split with a limit.

### 3. CSRF state validation is bypassable
`sync/src/auth.rs:260-265` — The CSRF state check only runs if BOTH the cookie and the
query parameter are present:
```rust
if let (Some(expected), Some(got)) = (expected_state.as_ref(), params.state.as_ref()) {
```
If either is missing, validation is silently skipped. An attacker can craft a callback URL
without a `state` parameter to bypass the check entirely (login CSRF).

## High

### 4. Decryption failures silently drop ops with no logging
`react-local/src/lib/crypt.ts:61` — `catch { return null; }` silently swallows all
decryption errors. Combined with `sync.ts:227-233` which filters out nulls without
logging, corrupted or re-keyed blobs disappear silently. The user has records on the
server that never materialize on the client, with zero indication of the problem.

## Medium

### 5. `applyIncomingOps` doesn't update `created_at`/`updated_at` on conflict
`react-local/src/lib/sync.ts:319-326` (accounts), `329-344` (categories),
`347-371` (transactions) — The ON CONFLICT clauses update data fields but skip
`created_at` and `updated_at`. After syncing a change from another client, timestamps
in the local DB remain stale. Any UI or query relying on `updated_at` shows incorrect
values.

### 6. HLC counter overflow breaks lexicographic sorting
`react-local/src/lib/hlc.ts:70` — Counter is padded to 5 digits. If counter exceeds
99999 (e.g. 100000+ ops in the same millisecond due to `receive()` accumulation),
`padStart(5, '0')` produces a 6-character string. `"100000"` sorts before `"99999"`
lexicographically (`'1' < '9'`), breaking causality ordering. Unlikely in normal use
but possible under rapid `receive()` calls during large bootstrap pages.

### 7. Bootstrap doesn't advance persisted cursor for corrupted pages
`react-local/src/lib/sync.ts:520-525` — If all ops in a bootstrap page fail decryption
(return null from codec), `applyIncomingOps` returns `maxVersion: undefined` and
`setCursor` is never called. The server pagination cursor advances the local loop
variable, so the bootstrap completes — but the persisted IDB cursor doesn't advance. On
next reconnect, the same corrupted pages are re-fetched, wasting bandwidth indefinitely.

### 8. Broadcast channel overflow drops SSE clients silently
`sync/src/hub.rs:6` — `BROADCAST_CAP = 256`. Bulk imports pushing many ops rapidly fill
the channel. Lagged receivers get `RecvError::Lagged(n)` and the SSE stream closes
(`sync_api.rs:106`). Client auto-reconnects, but there's a window of stale UI.
Consider increasing capacity or implementing backpressure.

### 9. Transaction link ID parsing is fragile
`react-local/src/lib/sync.ts:295` — `id.split("_")` assumes transaction IDs never
contain underscores. If IDs ever use underscores, the split produces wrong results.
Consider using a different delimiter (e.g. `:` like the other types).

### 10. Client ID cookie loss causes echo
`sync/src/sync_api.rs:89,131-146` — No `max_age` on the `sync_client_id` cookie means
it's a session cookie, cleared on browser close. On restart the client gets a new ID,
SSE filter no longer matches, and the client receives its own pushed ops back as deltas.
HLC idempotency prevents corruption but triggers unnecessary UI invalidation. Set a
long `max_age` on the cookie.

### 11. No retry/backoff on push failure
`react-local/src/lib/sync.ts:600-601` — Push failure throws, caught by `.catch()`.
No retry with exponential backoff. Dirty rows accumulate during server downtime and are
never retried until the next local mutation or reconnect.

## Low

### 12. Server doesn't validate push op count
`sync/src/sync_api.rs:58` — No limit on `body.ops.len()`. A client could push thousands
of ops in one request, creating a long-running transaction and filling the broadcast
channel.

### 13. `publish_delta` silently ignores send failure
`sync/src/hub.rs:55` — `let _ = handle.broadcast.send(...)` discards the error. If all
SSE receivers disconnected, the delta is silently lost. Not a data loss issue (clients
will bootstrap on reconnect), but should at least log for observability.

### 14. Wasted salt generation on every login
`sync/src/auth.rs:308` — `random_b64(16)` is called on every OIDC callback, but the
ON CONFLICT clause in `upsert_user_with_salt` doesn't update the salt for existing users.
The generated salt is discarded. Not a bug (client gets the correct salt via `/auth/@me`),
but wasteful.
