import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { login } from "../../lib/sync-auth";
import { getSyncServerUrl, setSyncServerUrl } from "../../lib/use-sync";

export function LoginForm() {
	const { setAuth } = useSyncAuth();

	const mutation = useMutation({
		mutationFn: async (data: FormData) => {
			const serverUrl = (data.get("server_url") as string).trim();
			const userId = (data.get("user_id") as string).trim();
			const passphrase = data.get("passphrase") as string;

			if (!serverUrl || !userId || !passphrase) throw new Error("All fields are required");

			setSyncServerUrl(serverUrl);
			return login(userId, passphrase, serverUrl);
		},
		onSuccess: (auth) => setAuth(auth),
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				mutation.mutate(new FormData(e.currentTarget));
			}}
			className="flex flex-col gap-3"
		>
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
			{mutation.error && <p className="text-red-11 text-xs">{mutation.error.message}</p>}
			<Button type="submit" disabled={mutation.isPending}>
				{mutation.isPending ? "Logging in..." : "Log in"}
			</Button>
		</form>
	);
}
