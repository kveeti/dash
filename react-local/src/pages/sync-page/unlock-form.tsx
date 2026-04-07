import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { useSyncAuth } from "../../providers";
import { unlock, clearAuth } from "../../lib/sync-auth";
import { getSyncServerUrl } from "../../lib/use-sync";

export function UnlockForm() {
	const { setAuth } = useSyncAuth();

	const mutation = useMutation({
		mutationFn: async (data: FormData) => {
			const passphrase = data.get("passphrase") as string;
			if (!passphrase) throw new Error("Passphrase is required");

			const serverUrl = getSyncServerUrl();
			if (!serverUrl) throw new Error("No server URL configured");

			return unlock(passphrase, serverUrl);
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
			<p className="text-gray-11 text-xs">
				Enter your passphrase to unlock sync.
			</p>
			<Input
				label="Passphrase"
				name="passphrase"
				type="password"
				autoFocus
			/>
			{mutation.error && <p className="text-red-11 text-xs">{mutation.error.message}</p>}
			<div className="flex gap-2">
				<Button type="submit" disabled={mutation.isPending}>
					{mutation.isPending ? "Unlocking..." : "Unlock"}
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
