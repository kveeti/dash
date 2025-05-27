use crate::state::AppState;

pub async fn recover_pending_imports(state: AppState) {
    let pending_imports = match state.data.get_pending_imports().await {
        Ok(imports) => imports,
        Err(e) => {
            tracing::error!("failed to fetch pending imports: {}", e);
            return;
        }
    };

    tracing::info!("found {} pending imports to recover", pending_imports.len());

    for (user_id, import_id) in pending_imports {
        let state_clone = state.clone();
        let user_id_clone = user_id.clone();
        let import_id_clone = import_id.clone();

        tokio::spawn(async move {
            tracing::info!(
                "recovering import {} for user {}",
                import_id_clone,
                user_id_clone
            );
            if let Err(e) = state_clone
                .data
                .import_tx_phase_2_v2(&user_id_clone, &import_id_clone)
                .await
            {
                tracing::error!("recovery failed for import {}: {}", import_id_clone, e);
            }
        });
    }
}
