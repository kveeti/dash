import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useDb } from "../../providers";
import {
	type SyncConfig,
	getSyncConfig,
	saveSyncConfig,
	clearSyncConfig,
	enableSync,
	sync,
	getSyncCounters,
} from "../../lib/sync";
import { useQueryClient } from "@tanstack/react-query";

const SCHEMA_VERSION = 1;

export function SyncPage() {
	const [config, setConfig] = useState<SyncConfig | null>(getSyncConfig);

	if (!config) {
		return <SetupSync onEnabled={setConfig} />;
	}

	return <SyncDashboard config={config} onDisable={() => setConfig(null)} />;
}

function SetupSync({ onEnabled }: { onEnabled: (s: SyncConfig) => void }) {
	const [mode, setMode] = useState<"new" | "existing" | null>(null);

	return (
		<div className="w-full mx-auto max-w-[25rem] mt-14">
			<h1 className="text-lg mb-4">sync</h1>

			<p className="text-sm text-gray-11 mb-6">
				sync your data across devices. all data is encrypted before
				leaving this device.
			</p>

			{!mode && (
				<div className="flex gap-3">
					<Button onClick={() => setMode("new")}>set up new</Button>
					<Button variant="outline" onClick={() => setMode("existing")}>
						join existing
					</Button>
				</div>
			)}

			{mode === "new" && <NewSyncSetup onEnabled={onEnabled} />}
			{mode === "existing" && <JoinSyncSetup onEnabled={onEnabled} />}
		</div>
	);
}

function NewSyncSetup({ onEnabled }: { onEnabled: (s: SyncConfig) => void }) {
	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const serverUrl = (data.get("server") as string).trim();
		const passphrase = (data.get("passphrase") as string).trim();

		if (!serverUrl || !passphrase) return;

		const config = enableSync({ syncId: crypto.randomUUID(), serverUrl, passphrase });
		onEnabled(config);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4 mt-4">
			<Input
				label="sync server url"
				name="server"
				type="url"
				placeholder="https://sync.example.com"
				required
			/>
			<Input
				label="passphrase"
				name="passphrase"
				type="text"
				placeholder="choose a strong passphrase"
				required
				minLength={8}
			/>
			<p className="text-xs text-gray-10">
				remember this passphrase — you'll need it to set up other
				devices. if you lose it, your synced data cannot be recovered.
			</p>
			<Button type="submit">enable sync</Button>
		</form>
	);
}

function JoinSyncSetup({ onEnabled }: { onEnabled: (s: SyncConfig) => void }) {
	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const serverUrl = (data.get("server") as string).trim();
		const syncId = (data.get("sync_id") as string).trim();
		const passphrase = (data.get("passphrase") as string).trim();

		if (!serverUrl || !syncId || !passphrase) return;

		const config = enableSync({ syncId, serverUrl, passphrase });
		onEnabled(config);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4 mt-4">
			<Input
				label="sync server url"
				name="server"
				type="url"
				placeholder="https://sync.example.com"
				required
			/>
			<Input
				label="sync id"
				name="sync_id"
				type="text"
				placeholder="paste your sync id"
				required
			/>
			<Input
				label="passphrase"
				name="passphrase"
				type="text"
				placeholder="your passphrase"
				required
			/>
			<Button type="submit">join sync</Button>
		</form>
	);
}

function SyncDashboard({
	config,
	onDisable,
}: {
	config: SyncConfig;
	onDisable: () => void;
}) {
	const db = useDb();
	const qc = useQueryClient();
	const [status, setStatus] = useState<string>("idle");
	const [lastResult, setLastResult] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [counters, setCounters] = useState<{ seq: number; last_pushed_seq: number; cursor: number } | null>(null);

	useEffect(() => {
		getSyncCounters(db).then(setCounters);
	}, [db, lastResult]);

	const doSync = useCallback(async () => {
		setStatus("syncing...");
		setError(null);
		try {
			const result = await sync(db, config, SCHEMA_VERSION);
			setLastResult(
				`pulled ${result.pulled} changeset${result.pulled !== 1 ? "s" : ""}, pushed ${result.pushed}`,
			);
			setStatus("idle");
			if (result.pulled > 0) {
				qc.invalidateQueries();
			}
		} catch (e: any) {
			setError(e.message);
			setStatus("error");
		}
	}, [db, config, qc]);

	function handleDisable() {
		clearSyncConfig();
		onDisable();
	}

	return (
		<div className="w-full mx-auto max-w-[25rem] mt-14">
			<h1 className="text-lg mb-4">sync</h1>

			<div className="space-y-4">
				<div className="text-sm space-y-2">
					<div className="flex justify-between">
						<span className="text-gray-11">status</span>
						<span>{status}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-gray-11">cursor</span>
						<span>{counters?.cursor ?? "—"}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-gray-11">local seq</span>
						<span>{counters?.seq ?? "—"}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-gray-11">last pushed seq</span>
						<span>{counters?.last_pushed_seq ?? "—"}</span>
					</div>
					{lastResult && (
						<div className="flex justify-between">
							<span className="text-gray-11">last sync</span>
							<span>{lastResult}</span>
						</div>
					)}
					{error && (
						<div className="text-red-11 text-xs mt-2">{error}</div>
					)}
				</div>

				<div className="flex gap-3">
					<Button onClick={doSync} disabled={status === "syncing..."}>
						sync now
					</Button>
					<Button variant="ghost" onClick={() => {
						navigator.clipboard.writeText(config.syncId);
					}}>
						copy sync id
					</Button>
				</div>

				<div className="border-t border-gray-a4 pt-4 mt-6">
					<Button variant="destructive" onClick={handleDisable}>
						disable sync
					</Button>
					<p className="text-xs text-gray-10 mt-2">
						this only removes sync from this device. your data stays
						on the server for other devices.
					</p>
				</div>
			</div>
		</div>
	);
}
