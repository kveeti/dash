import { Button } from "../../components/button";
import type { SyncStatus } from "../../lib/use-sync";

export function SyncStatusView({
	status,
	error,
	lastSyncAt,
	onSync,
	onLogout,
	onForceReset,
}: {
	status: SyncStatus;
	error: string | null;
	lastSyncAt: Date | null;
	onSync: () => void;
	onLogout: () => void;
	onForceReset: () => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<StatusDot status={status} />
				<span className="text-sm">
					{status === "syncing" && "Syncing..."}
					{status === "idle" && "Synced"}
					{status === "error" && "Sync error"}
				</span>
			</div>

			{lastSyncAt && (
				<p className="text-gray-11 text-xs">
					Last synced: {lastSyncAt.toLocaleString()}
				</p>
			)}

			{error && (
				<p className="text-red-11 text-xs">{error}</p>
			)}

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={onSync}
					disabled={status === "syncing"}
				>
					Sync now
				</Button>
				{status === "error" && (
					<Button
						variant="destructive"
						size="sm"
						onClick={onForceReset}
					>
						Force reset
					</Button>
				)}
			</div>

			<hr className="border-gray-a4" />

			<Button variant="ghost" size="sm" onClick={onLogout} className="self-start">
				Disconnect
			</Button>
		</div>
	);
}

function StatusDot({ status }: { status: SyncStatus }) {
	const colors: Record<SyncStatus, string> = {
		idle: "bg-green-9",
		syncing: "bg-yellow-9",
		error: "bg-red-9",
		locked: "bg-gray-8",
		unconfigured: "bg-gray-8",
	};

	return (
		<span
			className={`inline-block size-2 rounded-full ${colors[status]}`}
		/>
	);
}

export { StatusDot };
