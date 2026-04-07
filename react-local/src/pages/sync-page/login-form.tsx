import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { login } from "../../lib/sync-auth";
import { getSyncServerUrl, setSyncServerUrl } from "../../lib/use-sync";

export function LoginForm() {
	const { setAuth } = useSyncAuth();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const serverUrl = (data.get("server_url") as string).trim();
		const userId = (data.get("user_id") as string).trim();
		const passphrase = data.get("passphrase") as string;

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
				name="server_url"
				defaultValue={getSyncServerUrl()}
				placeholder="https://sync.example.com"
			/>
			<Input
				label="User ID"
				name="user_id"
				placeholder="uuid from signup"
			/>
			<Input
				label="Passphrase"
				name="passphrase"
				type="password"
			/>
			{error && <p className="text-red-11 text-xs">{error}</p>}
			<Button type="submit" disabled={loading}>
				{loading ? "Logging in..." : "Log in"}
			</Button>
		</form>
	);
}
