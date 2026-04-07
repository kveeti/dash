import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { login } from "../../lib/sync-auth";
import { getSyncServerUrl, setSyncServerUrl } from "../../lib/use-sync";

export function LoginForm() {
	const { setAuth } = useSyncAuth();
	const [serverUrl, setServerUrl] = useState(getSyncServerUrl);
	const [userId, setUserId] = useState("");
	const [passphrase, setPassphrase] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!serverUrl || !userId || !passphrase) {
			setError("All fields are required");
			return;
		}

		setLoading(true);
		setError(null);
		try {
			setSyncServerUrl(serverUrl);
			const auth = await login(userId, passphrase, serverUrl);
			setAuth(auth);
		} catch (e: any) {
			setError(e.message ?? String(e));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<Input
				label="Server URL"
				value={serverUrl}
				onChange={(e) => setServerUrl(e.currentTarget.value)}
				placeholder="https://sync.example.com"
			/>
			<Input
				label="User ID"
				value={userId}
				onChange={(e) => setUserId(e.currentTarget.value)}
				placeholder="uuid from signup"
			/>
			<Input
				label="Passphrase"
				type="password"
				value={passphrase}
				onChange={(e) => setPassphrase(e.currentTarget.value)}
			/>
			{error && <p className="text-red-11 text-xs">{error}</p>}
			<Button type="submit" disabled={loading}>
				{loading ? "Logging in..." : "Log in"}
			</Button>
		</form>
	);
}
