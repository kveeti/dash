import { decodeBase64Url, encodeBase64Url } from "./crypto";

const PRF_SALT_LABEL = "dash-prf-input-v1";

type PrfInputValues = {
	first: BufferSource;
	second?: BufferSource;
};

type PrfExtensionInput = {
	eval?: PrfInputValues;
	evalByCredential?: Record<string, PrfInputValues>;
};

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
	getClientExtensionResults(): AuthenticationExtensionsClientOutputs & {
		prf?: {
			enabled?: boolean;
			results?: {
				first?: ArrayBuffer;
				second?: ArrayBuffer;
			};
			resultsByCredential?: Record<
				string,
				{
					first?: ArrayBuffer;
					second?: ArrayBuffer;
				}
			>;
		};
	};
};

let globalSaltPromise: Promise<Uint8Array<ArrayBuffer>> | null = null;

export async function getGlobalPrfSalt(): Promise<Uint8Array<ArrayBuffer>> {
	if (!globalSaltPromise) {
		globalSaltPromise = crypto.subtle
			.digest("SHA-256", new TextEncoder().encode(PRF_SALT_LABEL))
			.then((digest) => new Uint8Array(digest));
	}
	return await globalSaltPromise;
}

export function isWebAuthnPrfAvailable(): boolean {
	return (
		globalThis.isSecureContext !== false &&
		!!globalThis.crypto?.subtle &&
		typeof PublicKeyCredential !== "undefined" &&
		typeof navigator !== "undefined" &&
		!!navigator.credentials
	);
}

export async function assertWebAuthnPrfAvailable(): Promise<void> {
	if (!isWebAuthnPrfAvailable()) {
		throw new Error("This browser does not support passkeys with WebAuthn PRF");
	}

	const capabilities = await PublicKeyCredential.getClientCapabilities?.();
	if (capabilities && capabilities.prf === false) {
		throw new Error("This browser does not support WebAuthn PRF");
	}
}

export async function registerPasskeyWithPrf(): Promise<{
	credentialId: string;
	prfKey: Uint8Array<ArrayBuffer>;
}> {
	await assertWebAuthnPrfAvailable();
	const salt = await getGlobalPrfSalt();
	const credential = await navigator.credentials.create({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			rp: {
				name: "Dash",
			},
			user: {
				id: crypto.getRandomValues(new Uint8Array(32)),
				name: "dash-local-user",
				displayName: "Dash local user",
			},
			pubKeyCredParams: [
				{ type: "public-key", alg: -8 },
				{ type: "public-key", alg: -7 },
				{ type: "public-key", alg: -257 },
			],
			authenticatorSelection: {
				residentKey: "preferred",
				userVerification: "required",
			},
			extensions: {
				prf: {
					eval: { first: salt },
				} satisfies PrfExtensionInput,
			} as AuthenticationExtensionsClientInputs,
		},
	});

	if (!(credential instanceof PublicKeyCredential)) {
		throw new Error("Passkey registration did not return a public key credential");
	}

	const credentialWithPrf = credential as PublicKeyCredentialWithPrf;
	const credentialId = encodeBase64Url(new Uint8Array(credential.rawId));
	return {
		credentialId,
		prfKey: extractPrfKey(credentialWithPrf, credentialId),
	};
}

export async function authenticateWithPasskeyPrf(
	credentialId: string,
): Promise<Uint8Array<ArrayBuffer>> {
	await assertWebAuthnPrfAvailable();
	const salt = await getGlobalPrfSalt();
	const allowCredentialId = decodeBase64Url(credentialId);
	const credential = await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			allowCredentials: [
				{
					type: "public-key",
					id: allowCredentialId,
				},
			],
			userVerification: "required",
			extensions: {
				prf: {
					eval: { first: salt },
					evalByCredential: {
						[credentialId]: { first: salt },
					},
				} satisfies PrfExtensionInput,
			} as AuthenticationExtensionsClientInputs,
		},
	});

	if (!(credential instanceof PublicKeyCredential)) {
		throw new Error("Passkey authentication did not return a public key credential");
	}

	return extractPrfKey(credential as PublicKeyCredentialWithPrf, credentialId);
}

function extractPrfKey(
	credential: PublicKeyCredentialWithPrf,
	credentialId: string,
): Uint8Array<ArrayBuffer> {
	const prf = credential.getClientExtensionResults().prf;
	const result =
		prf?.results?.first ?? prf?.resultsByCredential?.[credentialId]?.first;
	if (!result) {
		if (prf?.enabled === false) {
			throw new Error("This passkey provider does not support WebAuthn PRF");
		}
		throw new Error("WebAuthn PRF did not return key material");
	}
	const prfKey = new Uint8Array(result);
	if (prfKey.byteLength !== 32) {
		throw new Error("WebAuthn PRF returned invalid key material");
	}
	return prfKey;
}
