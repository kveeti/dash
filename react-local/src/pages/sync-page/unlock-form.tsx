import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { unlock, clearAuth } from "../../lib/sync-auth";
import { getSyncServerUrl } from "../../lib/use-sync";

export function UnlockForm() {
	const { setAuth } = useSyncAuth();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const passphrase = data.get("passphrase") as string;
		if (!passphrase) return;

		const serverUrl = getSyncServerUrl();
		if (!serverUrl) {
			setError("No server URL configured");
			return;
		}

		setLoading(true);
		setError(null);
		try {
			const auth = await unlock(passphrase, serverUrl);
			setAuth(auth);
		} catch (e: any) {
			setError(e.message ?? String(e));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<p className="text-gray-11 text-xs">
				Enter your passphrase to unlock sync.
			</p>
			<Input
				label="Passphrase"
				name="passphrase"
				type="password"
				autoFocus
			/>
			{error && <p className="text-red-11 text-xs">{error}</p>}
			<div className="flex gap-2">
				<Button type="submit" disabled={loading}>
					{loading ? "Unlocking..." : "Unlock"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					onClick={() => {
						clearAuth(getSyncServerUrl());
						setAuth(null);
					}}
				>
					Disconnect
				</Button>
			</div>
		</form>
	);
}
