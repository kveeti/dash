import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { unlock, clearAuth } from "../../lib/sync-auth";
import { getSyncServerUrl } from "../../lib/use-sync";

export function UnlockForm() {
	const { setAuth } = useSyncAuth();
	const [passphrase, setPassphrase] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
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
				type="password"
				value={passphrase}
				onChange={(e) => setPassphrase(e.currentTarget.value)}
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
						clearAuth();
						setAuth(null);
					}}
				>
					Disconnect
				</Button>
			</div>
		</form>
	);
}
