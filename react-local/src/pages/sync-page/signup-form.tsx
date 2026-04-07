import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { signup } from "../../lib/sync-auth";
import { getSyncServerUrl, setSyncServerUrl } from "../../lib/use-sync";

export function SignupForm() {
	const { setAuth } = useSyncAuth();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const data = new FormData(e.currentTarget);
		const serverUrl = (data.get("server_url") as string).trim();
		const passphrase = data.get("passphrase") as string;
		const confirm = data.get("confirm") as string;

		if (!serverUrl) {
			setError("Server URL is required");
			return;
		}
		if (passphrase.length < 8) {
			setError("Passphrase must be at least 8 characters");
			return;
		}
		if (passphrase !== confirm) {
			setError("Passphrases don't match");
			return;
		}

		setLoading(true);
		setError(null);
		try {
			setSyncServerUrl(serverUrl);
			const auth = await signup(passphrase, serverUrl);
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
				label="Passphrase"
				name="passphrase"
				type="password"
				placeholder="min 8 characters"
			/>
			<Input
				label="Confirm passphrase"
				name="confirm"
				type="password"
			/>
			{error && <p className="text-red-11 text-xs">{error}</p>}
			<Button type="submit" disabled={loading}>
				{loading ? "Creating account..." : "Sign up"}
			</Button>
		</form>
	);
}
