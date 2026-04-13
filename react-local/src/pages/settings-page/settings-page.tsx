import { useLiveQuery } from "dexie-react-hooks";
import { Button, buttonStyles } from "../../components/button";
import { Input } from "../../components/input";
import { Spinner } from "../../components/spinner";
import { decodeBase64, deriveCryptoKeyFromPassphrase } from "../../lib/crypt";
import { useMe } from "../../lib/queries/auth";
import { idb, uiStorageDefaults, type UiStorage } from "../../lib/sync";

export function SettingsPage() {
	return (
		<div className="pt-14 space-y-8 max-w-[35rem] w-full mx-auto">
			<h1 className="font-medium text-2xl font-cool">Settings</h1>

			<SyncSection />
		</div>
	);
}

function SyncSection() {
	return (
		<div>
			<h2 className="text-2xl font-cool">Sync</h2>

			<SyncSectionContent />
		</div>
	);
}

function SyncSectionContent() {
	const me = useMe();
	const uiStorage = useLiveQuery(
		async () => {
			return await idb.uiStorage
				.where("id")
				.equals(uiStorageDefaults.id)
				.first();
		},
		[],
		"loading",
	);

	if (me.isError) {
		return <p>Error getting user info</p>;
	}

	if (me.isLoading || uiStorage === "loading") {
		return (
			<div className="pt-4">
				<Spinner />
			</div>
		);
	}

	if (!me.data) {
		return (
			<div className="pt-4">
				<p>Login and enable sync</p>

				<a
					href="/api/v1/auth/init"
					className={buttonStyles() + " " + "mt-4"}
					target="_self"
				>
					Login
				</a>
			</div>
		);
	}

	return (
		<SyncSectionLoggedInContent uiStorage={uiStorage} salt={me.data.salt} />
	);
}

function SyncSectionLoggedInContent({
	uiStorage,
	salt,
}: {
	uiStorage: UiStorage | undefined;
	salt: string;
}) {
	const syncState = uiStorage?.sync_state;

	return (
		<div className="pt-2 space-y-6">
			{syncState === "enabled" ? (
				<div className="space-y-2 pt-1">
					<p>Syncing enabled</p>

					<Button
						variant="outline"
						onClick={async () => {
							await idb.uiStorage.put({
								...(uiStorage ?? uiStorageDefaults),
								sync_state: "paused",
							});
						}}
					>
						Pause syncing
					</Button>
				</div>
			) : syncState === "paused" ? (
				<div className="space-y-2 pt-1">
					<p>Syncing paused</p>
					<Button
						variant="outline"
						onClick={async () => {
							await idb.uiStorage.put({
								...(uiStorage ?? uiStorageDefaults),
								sync_state: "enabled",
							});
						}}
					>
						Resume syncing
					</Button>
				</div>
			) : (
				<div className="pb-1 space-y-6">
					<p>Syncing disabled. Enable by setting a passphrase</p>
					<EnableSyncingForm uiStorage={uiStorage} salt={salt} />
				</div>
			)}

			<div className="space-y-2">
				<p>Logged in</p>
				<a
					href="/api/v1/auth/logout"
					className={buttonStyles({ variant: "outline" })}
					target="_self"
				>
					Logout
				</a>
			</div>
		</div>
	);
}

function EnableSyncingForm({
	uiStorage,
	salt,
}: {
	uiStorage: UiStorage | undefined;
	salt: string;
}) {
	return (
		<form
			className="space-y-2"
			onSubmit={async (ev) => {
				ev.preventDefault();
				const data = new FormData(ev.currentTarget);
				const pass1 = data.get("pass1") as string | null;
				// const pass2 = data.get("pass2") as string | null;

				// if (!pass1 || !pass2 || pass1 !== pass2) return;
				if (!pass1) return;
				const dek = await deriveCryptoKeyFromPassphrase(
					pass1,
					decodeBase64(salt),
				);
				await idb.uiStorage.put({
					...(uiStorage ?? uiStorageDefaults),
					dek,
					sync_state: "enabled",
				});
			}}
		>
			<Input label="Passphrase" name="pass1" />

			<Button>Start syncing</Button>
		</form>
	);
}
