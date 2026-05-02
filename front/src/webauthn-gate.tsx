import { useMutation } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, type ReactNode } from "react";
import { Button } from "./components/button";
import { Spinner } from "./components/spinner";
import {
	deriveAccountRootKey,
	generateMnemonic,
	mnemonicToSeed,
	unwrapAccountRootKey,
	wrapAccountRootKey,
} from "./lib/crypto";
import { getUiStorage, idb, uiStorageDefaults } from "./lib/local-storage";
import {
	assertWebAuthnPrfAvailable,
	authenticateWithPasskeyPrf,
	registerPasskeyWithPrf,
} from "./lib/webauthn";
import { Checkbox } from "./components/checkbox";

type GateState =
	| { status: "locked" }
	| { status: "ready"; accountRootKey: Uint8Array<ArrayBuffer> };

export function WebAuthnGate(props: {
	children: (accountRootKey: Uint8Array<ArrayBuffer>) => ReactNode;
}) {
	const [gateState, setGateState] = useState<GateState>({ status: "locked" });
	const uiStorage = useLiveQuery(getUiStorage, [], "loading");

	if (gateState.status === "ready") {
		return props.children(gateState.accountRootKey);
	}

	if (uiStorage === "loading") {
		return (
			<div className="p-6">
				<Spinner />
			</div>
		);
	}

	if (uiStorage?.wrapped_account_root_key && uiStorage.passkey_credential_id) {
		return (
			<UnlockScreen
				wrappedAccountRootKey={uiStorage.wrapped_account_root_key}
				credentialId={uiStorage.passkey_credential_id}
				onReady={(accountRootKey) =>
					setGateState({ status: "ready", accountRootKey })
				}
			/>
		);
	}

	return (
		<OnboardingScreen
			onReady={(accountRootKey) =>
				setGateState({ status: "ready", accountRootKey })
			}
		/>
	);
}

function UnlockScreen(props: {
	wrappedAccountRootKey: NonNullable<
		Awaited<ReturnType<typeof getUiStorage>>
	>["wrapped_account_root_key"];
	credentialId: string;
	onReady: (accountRootKey: Uint8Array<ArrayBuffer>) => void;
}) {
	const unlock = useMutation({
		mutationFn: async () => {
			if (!props.wrappedAccountRootKey) {
				throw new Error("Missing wrapped account root key");
			}
			const prfKey = await authenticateWithPasskeyPrf(props.credentialId);
			return await unwrapAccountRootKey(props.wrappedAccountRootKey, prfKey);
		},
		onSuccess: props.onReady,
	});

	return (
		<main className="min-h-dvh flex items-center justify-center p-6">
			<div className="w-full max-w-sm space-y-4">
				<div>
					<h1 className="font-cool text-2xl font-medium">Unlock</h1>
					<p className="pt-1 text-sm text-gray-10">
						Use this device's passkey to unlock the local encrypted database.
					</p>
				</div>
				<Button
					isLoading={unlock.isPending}
					disabled={unlock.isPending}
					onClick={() => unlock.mutate()}
				>
					Unlock with passkey
				</Button>
				{unlock.error ? (
					<p className="text-xs text-red-11">{getErrorMessage(unlock.error)}</p>
				) : null}
			</div>
		</main>
	);
}

const checkboxId = "user-wrote-down-words";
const wordsId = "words";

function OnboardingScreen(props: {
	onReady: (accountRootKey: Uint8Array<ArrayBuffer>) => void;
}) {
	const setup = useMutation({ mutationFn: setupFromMnemonic });

	async function onSubmit(e) {
		e.preventDefault();
		if (setup.isPending) return;

		const data = new FormData(e.currentTarget);
		const userWroteDownWords = data.get(checkboxId);
		if (!userWroteDownWords) return;

		const words = data.get(wordsId) as string;
		if (!words.trim()) return;

		const accountRootKey = await setup.mutateAsync(words);
		props.onReady(accountRootKey);
	}

	const [words, setWords] = useState(null);

	return (
		<main className="min-h-dvh flex items-center justify-center p-6">
			<div className="w-full max-w-xl space-y-6">
				<div>
					<h1 className="font-cool text-2xl font-medium">Set up</h1>
					<p className="pt-1 text-sm text-gray-10">
						Your 24 words are the recovery key for sync and this local database.
					</p>
				</div>

				<form
					className="border border-gray-a4 p-3"
					onSubmit={onSubmit}
				>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							setWords(generateMnemonic());
						}}
					>
						Generate 24 words
					</Button>

					{words ? (
						<div className="flex flex-col gap-3 mt-3">
							<textarea
								readOnly
								defaultValue={words}
								name={wordsId}
								className="min-h-24 w-full rounded border border-gray-a5 p-2 text-sm"
							/>
							<Checkbox label="I wrote down these 24 words." name={checkboxId} />
							<div className="text-end">
								<Button
									type="submit"
									isLoading={setup.isPending}
								>
									Create passkey
								</Button>
							</div>
						</div>
					) : null}

					{setup.error ? (
						<p className="text-xs text-red-11 mt-3">{getErrorMessage(setup.error)}</p>
					) : null}
				</form>

				<RecoveryForm onReady={props.onReady} />
			</div>
		</main>
	);
}

function RecoveryForm(props: {
	onReady: (accountRootKey: Uint8Array<ArrayBuffer>) => void;
}) {
	const recover = useMutation({ mutationFn: setupFromMnemonic });

	async function onSubmit(e) {
		e.preventDefault();
		if (recover.isPending) return;

		const words = new FormData(e.currentTarget).get(wordsId) as string;
		if (!words.trim()) return;

		const accountRootKey = await recover.mutateAsync(words);
		props.onReady(accountRootKey);
	}

	return (
		<form
			className="space-y-3 border border-gray-a4 p-3"
			onSubmit={onSubmit}
		>
			<div>
				<p className="text-sm">Recover from 24 words</p>
				<p className="pt-1 text-xs text-gray-10">
					This creates a new passkey wrapper for this device.
				</p>
			</div>

			<textarea
				name={wordsId}
				placeholder="24 words separated by spaces"
				className="min-h-20 w-full rounded border border-gray-a5 p-2 text-sm"
			/>

			<div className="text-end">
				<Button
					type="submit"
					isLoading={recover.isPending}
				>
					Recover and create passkey
				</Button>
			</div>

			{recover.error ? (
				<p className="text-xs text-red-11">{getErrorMessage(recover.error)}</p>
			) : null}
		</form>
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function setupFromMnemonic(words: string): Promise<Uint8Array<ArrayBuffer>> {
	await assertWebAuthnPrfAvailable();
	const existing = await getUiStorage();
	if (existing?.wrapped_account_root_key || existing?.passkey_credential_id) {
		throw new Error("passkey already configured");
	}

	const bip39Seed = await mnemonicToSeed(words);
	try {
		const accountRootKey = await deriveAccountRootKey(bip39Seed);
		const { credentialId, prfKey } = await registerPasskeyWithPrf();
		const wrappedAccountRootKey = await wrapAccountRootKey(
			accountRootKey,
			prfKey,
		);
		await idb.uiStorage.put({
			...uiStorageDefaults,
			wrapped_account_root_key: wrappedAccountRootKey,
			passkey_credential_id: credentialId,
			sync_state: "not_configured",
		});
		return accountRootKey;
	} finally {
		bip39Seed.fill(0);
	}
}
