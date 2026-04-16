use std::sync::Arc;

use base64::Engine;
use dashmap::DashMap;
use sqlx::{PgPool, Row};
use tokio::sync::{broadcast, mpsc};
use tracing::{error, warn};

use crate::proto::{DeltaOp, PushOp, ServerMessage};

const INBOX_CAP: usize = 64;
const BROADCAST_CAP: usize = 256;

/// The hub holds one actor per active user. Actors are spawned lazily on first
/// subscribe/push and live forever in the current impl; GC on last-unsubscribe
/// can be added later.
pub struct Hub {
    pool: PgPool,
    users: DashMap<String, UserHandle>,
}

#[derive(Clone)]
pub struct UserHandle {
    pub inbox: mpsc::Sender<ActorCommand>,
    pub broadcast: broadcast::Sender<Arc<ServerMessage>>,
}

pub enum ActorCommand {
    Push { batch_id: String, ops: Vec<PushOp> },
}

impl Hub {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            users: DashMap::new(),
        }
    }

    pub fn get_or_spawn(&self, user_id: &str) -> UserHandle {
        if let Some(existing) = self.users.get(user_id) {
            return existing.clone();
        }

        let (inbox_tx, inbox_rx) = mpsc::channel::<ActorCommand>(INBOX_CAP);
        let (bcast_tx, _) = broadcast::channel::<Arc<ServerMessage>>(BROADCAST_CAP);

        let handle = UserHandle {
            inbox: inbox_tx,
            broadcast: bcast_tx.clone(),
        };

        let user_id_owned = user_id.to_string();
        let pool = self.pool.clone();
        let bcast_for_actor = bcast_tx;
        tokio::spawn(async move {
            run_actor(user_id_owned, pool, inbox_rx, bcast_for_actor).await;
        });

        // Note: small race where two callers may both spawn; entry() resolves it.
        self.users
            .entry(user_id.to_string())
            .or_insert(handle)
            .clone()
    }
}

async fn run_actor(
    user_id: String,
    pool: PgPool,
    mut inbox: mpsc::Receiver<ActorCommand>,
    bcast: broadcast::Sender<Arc<ServerMessage>>,
) {
    while let Some(cmd) = inbox.recv().await {
        match cmd {
            ActorCommand::Push { batch_id, ops } => {
                match apply_push(&pool, &user_id, &ops).await {
                    Ok(applied) => {
                        // Always broadcast the ack (possibly with empty ops) so
                        // the originator can clear its pending state.
                        let msg = Arc::new(ServerMessage::Delta {
                            ack_for: Some(batch_id),
                            ops: applied,
                        });
                        // send() errors only when there are no subscribers,
                        // which is fine.
                        let _ = bcast.send(msg);
                    }
                    Err(err) => {
                        error!(%user_id, "apply_push failed: {:#}", err);
                        let msg = Arc::new(ServerMessage::Error {
                            code: "push_failed".into(),
                            message: Some(format!("{err:#}")),
                        });
                        let _ = bcast.send(msg);
                    }
                }
            }
        }
    }
}

async fn apply_push(
    pool: &PgPool,
    user_id: &str,
    ops: &[PushOp],
) -> Result<Vec<DeltaOp>, anyhow::Error> {
    if ops.is_empty() {
        return Ok(Vec::new());
    }

    let mut tx = pool.begin().await?;
    let mut applied: Vec<DeltaOp> = Vec::with_capacity(ops.len());

    for op in ops {
        let blob_bytes = base64::engine::general_purpose::STANDARD
            .decode(op.blob.as_bytes())
            .map_err(|e| anyhow::anyhow!("bad base64 blob for {}: {}", op.id, e))?;

        // nextval in the values clause means:
        //   - pure insert: the row gets this new version.
        //   - conflict + WHERE passes: update takes excluded._sync_server_version (the new one).
        //   - conflict + WHERE fails (stale HLC): no row returned, nextval burned (gap, harmless).
        let row_opt = sqlx::query(
            r#"
            insert into entries (
                user_id, id, blob, _sync_hlc, _sync_is_deleted,
                _sync_server_version, _sync_server_updated_at
            )
            values ($1, $2, $3, $4, $5, nextval('server_version'), now())
            on conflict (user_id, id) do update set
                blob = excluded.blob,
                _sync_hlc = excluded._sync_hlc,
                _sync_is_deleted = excluded._sync_is_deleted,
                _sync_server_version = excluded._sync_server_version,
                _sync_server_updated_at = now()
            where excluded._sync_hlc > entries._sync_hlc
            returning _sync_server_version, _sync_hlc, _sync_is_deleted
            "#,
        )
        .bind(user_id)
        .bind(&op.id)
        .bind(&blob_bytes)
        .bind(&op.hlc)
        .bind(op.is_deleted)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(row) = row_opt {
            let server_version: i64 = row.try_get("_sync_server_version")?;
            let hlc: String = row.try_get("_sync_hlc")?;
            let is_deleted: bool = row.try_get("_sync_is_deleted")?;
            applied.push(DeltaOp {
                id: op.id.clone(),
                hlc,
                blob: op.blob.clone(),
                is_deleted,
                server_version,
            });
        } else {
            warn!(%user_id, id = %op.id, hlc = %op.hlc, "push ignored (stale hlc)");
        }
    }

    tx.commit().await?;
    // Applied rows may not be in version order if some ops were rejected and
    // others accepted, but within a single commit the sequence-allocated values
    // are monotonic. Sort to be explicit (keeps wire-level invariants simple).
    applied.sort_by_key(|op| op.server_version);
    Ok(applied)
}
