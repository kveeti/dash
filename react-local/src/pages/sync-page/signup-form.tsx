import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { signup } from "../../lib/sync-auth";
import { getSyncServerUrl, setSyncServerUrl } from "../../lib/use-sync";

export function SignupForm() {
	const { setAuth } = useSyncAuth();

	const mutation = useMutation({
		mutationFn: async (data: FormData) => {
			const serverUrl = (data.get("server_url") as string).trim();
			const passphrase = data.get("passphrase") as string;
			const confirm = data.get("confirm") as string;

			if (!serverUrl) throw new Error("Server URL is required");
			if (passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters");
			if (passphrase !== confirm) throw new Error("Passphrases don't match");

			setSyncServerUrl(serverUrl);
			return signup(passphrase, serverUrl);
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
			{mutation.error && <p className="text-red-11 text-xs">{mutation.error.message}</p>}
			<Button type="submit" disabled={mutation.isPending}>
				{mutation.isPending ? "Creating account..." : "Sign up"}
			</Button>
		</form>
	);
}
