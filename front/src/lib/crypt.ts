import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const IV_BYTES = 12;
const DEK_SEED_BYTES = 32;
const BIP39_WORD_COUNT = 24;
const AUTH_ID_CONTEXT = "dash/auth/id/v1";
const AUTH_SIGNING_KEY_CONTEXT = "dash/auth/signing-key/v1";

export type SyncPayloadCodec = {
	encode: (payload: Record<string, unknown>) => Promise<string>;
	encodeJsonString: (payload: string) => Promise<string>;
	encodeJsonBytes: (payload: string) => Promise<Uint8Array>;
	decode: (blob: string) => Promise<Record<string, unknown> | null>;
	decodeBytes: (blob: Uint8Array) => Promise<Record<string, unknown> | null>;
};

export function parseJsonObjectBlob(blob: string): Record<string, unknown> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(blob);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const proto = Object.getPrototypeOf(parsed);
	if (proto !== Object.prototype && proto !== null) return null;
	return parsed as Record<string, unknown>;
}

export function createJsonSyncPayloadCodec(): SyncPayloadCodec {
	return {
		async encodeJsonString(payload) {
			return payload;
		},
		async encodeJsonBytes(payload) {
			return new TextEncoder().encode(payload);
		},
		async encode(payload): Promise<string> {
			return JSON.stringify(payload);
		},
		async decode(blob): Promise<Record<string, unknown> | null> {
			return parseJsonObjectBlob(blob);
		},
		async decodeBytes(blob): Promise<Record<string, unknown> | null> {
			return parseJsonObjectBlob(new TextDecoder().decode(blob));
		},
	};
}

export function createDekSyncPayloadCodec(dek: CryptoKey): SyncPayloadCodec {
	async function encodeJsonBytes(payload: string): Promise<Uint8Array> {
		const plaintext = new TextEncoder().encode(payload);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext);
		const packed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
		packed.set(iv, 0);
		packed.set(new Uint8Array(ciphertext), IV_BYTES);
		return packed;
	};
	async function decodeBytes(blob: Uint8Array): Promise<Record<string, unknown> | null> {
		try {
			if (blob.byteLength <= IV_BYTES) return null;
			const iv = blob.slice(0, IV_BYTES);
			const ciphertext = blob.slice(IV_BYTES);
			const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext);
			return parseJsonObjectBlob(new TextDecoder().decode(plaintext));
		} catch {
			return null;
		}
	}

	return {
		async encode(payload): Promise<string> {
			return encodeBase64(await encodeJsonBytes(JSON.stringify(payload)));
		},

		async encodeJsonString(payload): Promise<string> {
			return encodeBase64(await encodeJsonBytes(payload));
		},

		encodeJsonBytes,

		decodeBytes,

		async decode(blob): Promise<Record<string, unknown> | null> {
			return decodeBytes(decodeBase64(blob));
		},
	};
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (typeof globalThis.atob === 'function') {
		const binary = globalThis.atob(value);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			out[i] = binary.charCodeAt(i);
		}
		return out;
	}
	const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
	if (maybeBuffer) {
		return new Uint8Array(maybeBuffer.from(value, 'base64'));
	}
	throw new Error('base64 codec unavailable in runtime');
}

export function encodeBase64(value: Uint8Array<ArrayBuffer>): string {
	if (typeof globalThis.btoa === 'function') {
		let binary = '';
		for (let i = 0; i < value.length; i += 1) {
			binary += String.fromCharCode(value[i]);
		}
		return globalThis.btoa(binary);
	}
	const maybeBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer;
	if (maybeBuffer) {
		return maybeBuffer.from(value).toString('base64');
	}
	throw new Error('base64 codec unavailable in runtime');
}

const PBKDF2_ITERS = 300_000;

export async function deriveCryptoKeyFromPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
	const enc = new TextEncoder();

	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(passphrase),
		{ name: "PBKDF2" },
		false,
		["deriveKey"]
	);

	const cryptoKey = await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt,
			iterations: PBKDF2_ITERS,
			hash: "SHA-256"
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false, // extractable: false
		["encrypt", "decrypt"]
	);

	return cryptoKey;
}

export function createDekSeed(): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(DEK_SEED_BYTES));
}

export async function importDekFromSeed(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	if (seed.byteLength !== DEK_SEED_BYTES) {
		throw new Error("invalid dek seed length");
	}
	return await crypto.subtle.importKey(
		"raw",
		seed,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

export async function createLocalWrapKey(): Promise<CryptoKey> {
	return await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function wrapSeedForStorage(
	seed: Uint8Array<ArrayBuffer>,
	wrapKey: CryptoKey,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, seed);
	const packed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
	packed.set(iv, 0);
	packed.set(new Uint8Array(ciphertext), IV_BYTES);
	return encodeBase64(packed);
}

export async function unwrapSeedFromStorage(
	wrappedSeed: string,
	wrapKey: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
	const packed = decodeBase64(wrappedSeed);
	if (packed.byteLength <= IV_BYTES) throw new Error("invalid wrapped seed");
	const iv = packed.slice(0, IV_BYTES);
	const ciphertext = packed.slice(IV_BYTES);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		wrapKey,
		ciphertext,
	);
	return new Uint8Array(plaintext);
}

export async function encodeDekSeedAsWords(
	seed: Uint8Array<ArrayBuffer>,
): Promise<string> {
	if (seed.byteLength !== DEK_SEED_BYTES) throw new Error("invalid dek seed length");
	return entropyToMnemonic(seed, wordlist);
}

export async function decodeDekSeedFromWords(wordsInput: string): Promise<Uint8Array<ArrayBuffer>> {
	const normalized = wordsInput.trim().toLowerCase().replace(/\s+/g, " ");
	const words = normalized.split(" ").filter(Boolean);
	if (words.length !== BIP39_WORD_COUNT) {
		throw new Error("expected 24 words");
	}
	if (!validateMnemonic(normalized, wordlist)) {
		throw new Error("invalid BIP39 mnemonic");
	}
	return mnemonicToEntropy(normalized, wordlist);
}

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
	return encodeBase64(bytes)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function sha256WithContext(
	context: string,
	seed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	if (seed.byteLength !== DEK_SEED_BYTES) {
		throw new Error("invalid dek seed length");
	}
	const contextBytes = new TextEncoder().encode(`${context}:`);
	const input = new Uint8Array(contextBytes.byteLength + seed.byteLength);
	input.set(contextBytes, 0);
	input.set(seed, contextBytes.byteLength);
	const digest = await crypto.subtle.digest("SHA-256", input);
	return new Uint8Array(digest);
}

export async function deriveAuthMaterialFromSeed(
	seed: Uint8Array<ArrayBuffer>,
): Promise<{ authId: string; authPublicKey: string; authPrivateKey: Uint8Array<ArrayBuffer> }> {
	const privateKey = await sha256WithContext(AUTH_SIGNING_KEY_CONTEXT, seed);
	const publicKey = ed25519.getPublicKey(privateKey);
	const idPrefix = new TextEncoder().encode(`${AUTH_ID_CONTEXT}:`);
	const idInput = new Uint8Array(idPrefix.byteLength + publicKey.byteLength);
	idInput.set(idPrefix, 0);
	idInput.set(publicKey, idPrefix.byteLength);
	const idDigest = await crypto.subtle.digest("SHA-256", idInput);
	return {
		authId: toBase64Url(new Uint8Array(idDigest)),
		authPublicKey: toBase64Url(publicKey),
		authPrivateKey: privateKey,
	};
}

export async function computeAuthChallengeSignature(input: {
	authPrivateKey: Uint8Array<ArrayBuffer>;
	challengeId: string;
	nonce: string;
}): Promise<string> {
	const payload = new TextEncoder().encode(`${input.challengeId}:${input.nonce}`);
	const signature = ed25519.sign(payload, input.authPrivateKey);
	return toBase64Url(new Uint8Array(signature));
}
