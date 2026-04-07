import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncAuth } from "../providers";
import { getPersistedAuth, clearAuth } from "./sync-auth";
import { runSync, clearSyncState, type SyncResult } from "./sync-engine";
import { useDb } from "../providers";

export type SyncStatus = "unconfigured" | "locked" | "idle" | "syncing" | "error";

const LS_LAST_SYNC_AT = "dash_last_sync_at";
const LS_SYNC_SERVER_URL = "dash_sync_server_url";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function getSyncServerUrl(): string {
	return localStorage.getItem(LS_SYNC_SERVER_URL) ?? "";
}

export function setSyncServerUrl(url: string) {
	localStorage.setItem(LS_SYNC_SERVER_URL, url.replace(/\/$/, ""));
}

export function useSync() {
	const db = useDb();
	const { auth, setAuth } = useSyncAuth();
	const [status, setStatus] = useState<SyncStatus>(() => {
		if (auth) return "idle";
		const persisted = getPersistedAuth();
		if (persisted) return "locked";
		return "unconfigured";
	});
	const [error, setError] = useState<string | null>(null);
	const [lastSyncAt, setLastSyncAt] = useState<Date | null>(() => {
		const stored = localStorage.getItem(LS_LAST_SYNC_AT);
		return stored ? new Date(stored) : null;
	});
	const syncingRef = useRef(false);

	// Update status when auth changes
	useEffect(() => {
		if (auth) {
			setStatus("idle");
			setError(null);
		} else {
			const persisted = getPersistedAuth();
			setStatus(persisted ? "locked" : "unconfigured");
		}
	}, [auth]);

	const sync = useCallback(async () => {
		if (!auth || syncingRef.current) return;
		const serverUrl = getSyncServerUrl();
		if (!serverUrl) return;

		syncingRef.current = true;
		setStatus("syncing");
		setError(null);

		try {
			const result: SyncResult = await runSync(db, auth.dek, serverUrl, auth.token);

			if (result.error) {
				setStatus("error");
				setError(result.error);
			} else {
				setStatus("idle");
				const now = new Date();
				setLastSyncAt(now);
				localStorage.setItem(LS_LAST_SYNC_AT, now.toISOString());
			}
		} catch (e: any) {
			setStatus("error");
			setError(e.message ?? String(e));
		} finally {
			syncingRef.current = false;
		}
	}, [auth, db]);

	const logout = useCallback(() => {
		clearAuth();
		clearSyncState();
		setAuth(null);
		setStatus("unconfigured");
		setError(null);
		setLastSyncAt(null);
		localStorage.removeItem(LS_LAST_SYNC_AT);
	}, [setAuth]);

	const forceReset = useCallback(async () => {
		clearSyncState();
		await sync();
	}, [sync]);

	// Auto-sync: on unlock, then every 5 min, and on tab focus
	useEffect(() => {
		if (!auth) return;

		// Sync immediately on unlock
		sync();

		const interval = setInterval(sync, SYNC_INTERVAL_MS);

		const onVisibility = () => {
			if (document.visibilityState === "visible") sync();
		};
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [auth, sync]);

	return { status, error, lastSyncAt, sync, logout, forceReset };
}
