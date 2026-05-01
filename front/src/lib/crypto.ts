import {
	generateMnemonic as generateBip39Mnemonic,
	mnemonicToSeedWebcrypto,
	validateMnemonic,
} from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const IV_BYTES = 12;
const DEK_SEED_BYTES = 32;
const BIP39_WORD_COUNT = 24;
const SYNC_ENVELOPE_VERSION = 1;
const SYNC_SCHEMA_VERSION = 1;
const AUTH_ID_CONTEXT = "dash/auth/id/v1";
const AUTH_SIGNING_KEY_CONTEXT = "dash/recovery-auth/v1";
const AUTH_CHALLENGE_CONTEXT = "dash/auth/challenge/v1";
const MASTER_DEK_CONTEXT = "dash/master-dek/v1";
const SYNC_CONTENT_KEY_CONTEXT = "dash/sync-content/v1";

export type WrappedDek = {
	v: 1;
	alg: "AES-256-GCM";
	iv: string;
	ciphertext: string;
};

export type SyncPayloadCodec = {
	encode: (payload: Record<string, unknown>, metadata: SyncPayloadMetadata) => Promise<string>;
	encodeJsonString: (payload: string, metadata: SyncPayloadMetadata) => Promise<string>;
	encodeJsonBytes: (payload: string, metadata: SyncPayloadMetadata) => Promise<Uint8Array<ArrayBuffer>>;
	decode: (blob: string, metadata: SyncPayloadMetadata) => Promise<Record<string, unknown>>;
	decodeBytes: (blob: Uint8Array, metadata: SyncPayloadMetadata) => Promise<Record<string, unknown>>;
};

export type SyncPayloadMetadata = {
	id: string;
	_sync_is_deleted: boolean;
	_sync_edited_at: number;
};

function asJsonObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return null;
	return value as Record<string, unknown>;
}

export function parseJsonObjectBlob(blob: string): Record<string, unknown> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(blob);
	} catch {
		return null;
	}
	return asJsonObject(parsed);
}

function buildSyncAad(metadata: SyncPayloadMetadata): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(
		JSON.stringify({
			ev: SYNC_ENVELOPE_VERSION,
			sv: SYNC_SCHEMA_VERSION,
			id: metadata.id,
			del: metadata._sync_is_deleted,
			ts: metadata._sync_edited_at,
		}),
	);
}

function encodeSyncEnvelopeString(
	payload: Record<string, unknown>,
	metadata: SyncPayloadMetadata,
): string {
	return JSON.stringify({
		ev: SYNC_ENVELOPE_VERSION,
		sv: SYNC_SCHEMA_VERSION,
		id: metadata.id,
		d: payload,
	});
}

function encodeSyncEnvelopeJsonString(
	payload: string,
	metadata: SyncPayloadMetadata,
): string {
	const data = parseJsonObjectBlob(payload);
	if (!data) {
		throw new Error("invalid sync payload data");
	}
	return encodeSyncEnvelopeString(data, metadata);
}

function decodeSyncEnvelopeString(
	plaintext: string,
	metadata: SyncPayloadMetadata,
): Record<string, unknown> {
	const envelope = parseJsonObjectBlob(plaintext);
	if (!envelope) {
		throw new Error("invalid sync envelope");
	}
	if (envelope.ev !== SYNC_ENVELOPE_VERSION) {
		throw new Error("unsupported sync envelope version");
	}
	if (envelope.sv !== SYNC_SCHEMA_VERSION) {
		throw new Error("unsupported sync schema version");
	}
	if (envelope.id !== metadata.id) {
		throw new Error("sync envelope id mismatch");
	}
	const data = asJsonObject(envelope.d);
	if (!data) {
		throw new Error("invalid sync envelope data");
	}
	return data;
}

export function createJsonSyncPayloadCodec(): SyncPayloadCodec {
	return {
		async encodeJsonString(payload, metadata) {
			return encodeSyncEnvelopeJsonString(payload, metadata);
		},
		async encodeJsonBytes(payload, metadata) {
			return new TextEncoder().encode(
				encodeSyncEnvelopeJsonString(payload, metadata),
			);
		},
		async encode(payload, metadata): Promise<string> {
			return encodeSyncEnvelopeString(payload, metadata);
		},
		async decode(blob, metadata): Promise<Record<string, unknown>> {
			return decodeSyncEnvelopeString(blob, metadata);
		},
		async decodeBytes(blob, metadata): Promise<Record<string, unknown>> {
			return decodeSyncEnvelopeString(new TextDecoder().decode(blob), metadata);
		},
	};
}

export function createDekSyncPayloadCodec(dek: CryptoKey): SyncPayloadCodec {
	async function encodeJsonBytes(
		payload: string,
		metadata: SyncPayloadMetadata,
	): Promise<Uint8Array<ArrayBuffer>> {
		const plaintext = new TextEncoder().encode(
			encodeSyncEnvelopeJsonString(payload, metadata),
		);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: buildSyncAad(metadata) },
			dek,
			plaintext,
		);
		const packed = new Uint8Array(1 + IV_BYTES + ciphertext.byteLength);
		packed[0] = SYNC_ENVELOPE_VERSION;
		packed.set(iv, 1);
		packed.set(new Uint8Array(ciphertext), 1 + IV_BYTES);
		return packed;
	};
	async function decodeBytes(
		blob: Uint8Array,
		metadata: SyncPayloadMetadata,
	): Promise<Record<string, unknown>> {
		if (blob.byteLength <= 1 + IV_BYTES) {
			throw new Error("invalid sync blob");
		}
		if (blob[0] !== SYNC_ENVELOPE_VERSION) {
			throw new Error("unsupported sync blob version");
		}
		const iv = blob.slice(1, 1 + IV_BYTES);
		const ciphertext = blob.slice(1 + IV_BYTES);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv, additionalData: buildSyncAad(metadata) },
			dek,
			ciphertext,
		);
		return decodeSyncEnvelopeString(new TextDecoder().decode(plaintext), metadata);
	}

	return {
		async encode(payload, metadata): Promise<string> {
			return encodeBase64(await encodeJsonBytes(JSON.stringify(payload), metadata));
		},

		async encodeJsonString(payload, metadata): Promise<string> {
			return encodeBase64(await encodeJsonBytes(payload, metadata));
		},

		encodeJsonBytes,

		decodeBytes,

		async decode(blob, metadata): Promise<Record<string, unknown>> {
			return decodeBytes(decodeBase64(blob), metadata);
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

export function encodeBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
	return encodeBase64(bytes)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"=",
	);
	return decodeBase64(padded);
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

async function importAesGcmKeyFromSeed(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
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

export async function importDekFromSeed(masterDek: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	const syncContentDek = await hkdfSha256(
		masterDek,
		SYNC_CONTENT_KEY_CONTEXT,
		DEK_SEED_BYTES,
	);
	try {
		return await importAesGcmKeyFromSeed(syncContentDek);
	} finally {
		syncContentDek.fill(0);
	}
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

export function generateMnemonic(): string {
	return generateBip39Mnemonic(wordlist, 256);
}

export function normalizeMnemonic(wordsInput: string): string {
	const normalized = wordsInput.trim().toLowerCase().replace(/\s+/g, " ");
	const words = normalized.split(" ").filter(Boolean);
	if (words.length !== BIP39_WORD_COUNT) {
		throw new Error("expected 24 words");
	}
	if (!validateMnemonic(normalized, wordlist)) {
		throw new Error("invalid BIP39 mnemonic");
	}
	return normalized;
}

export async function mnemonicToSeed(wordsInput: string): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await mnemonicToSeedWebcrypto(normalizeMnemonic(wordsInput)));
}

export async function deriveMasterDek(
	bip39Seed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return await hkdfSha256(bip39Seed, MASTER_DEK_CONTEXT, DEK_SEED_BYTES);
}

export async function hkdfSha256(
	inputKeyMaterial: Uint8Array<ArrayBuffer>,
	info: string,
	lengthBytes: number,
	salt = new Uint8Array(0),
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		"raw",
		inputKeyMaterial,
		"HKDF",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt,
			info: new TextEncoder().encode(info),
		},
		key,
		lengthBytes * 8,
	);
	return new Uint8Array(bits);
}

async function importPrfWrapKey(prfKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	if (prfKey.byteLength !== DEK_SEED_BYTES) {
		throw new Error("invalid WebAuthn PRF key length");
	}
	return await crypto.subtle.importKey(
		"raw",
		prfKey,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

export async function wrapDek(
	masterDek: Uint8Array<ArrayBuffer>,
	prfKey: Uint8Array<ArrayBuffer>,
): Promise<WrappedDek> {
	if (masterDek.byteLength !== DEK_SEED_BYTES) {
		throw new Error("invalid master DEK length");
	}
	const wrapKey = await importPrfWrapKey(prfKey);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		wrapKey,
		masterDek,
	);
	return {
		v: 1,
		alg: "AES-256-GCM",
		iv: encodeBase64(iv),
		ciphertext: encodeBase64(new Uint8Array(ciphertext)),
	};
}

export async function unwrapDek(
	wrappedDek: WrappedDek,
	prfKey: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	if (wrappedDek.v !== 1 || wrappedDek.alg !== "AES-256-GCM") {
		throw new Error("unsupported wrapped DEK format");
	}
	const wrapKey = await importPrfWrapKey(prfKey);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: decodeBase64(wrappedDek.iv) },
		wrapKey,
		decodeBase64(wrappedDek.ciphertext),
	);
	const masterDek = new Uint8Array(plaintext);
	if (masterDek.byteLength !== DEK_SEED_BYTES) {
		throw new Error("invalid unwrapped master DEK length");
	}
	return masterDek;
}

export async function deriveAuthMaterialFromSeed(
	seed: Uint8Array<ArrayBuffer>,
): Promise<{ authId: string; authPublicKey: string; authPrivateKey: Uint8Array<ArrayBuffer> }> {
	const privateKey = await hkdfSha256(seed, AUTH_SIGNING_KEY_CONTEXT, DEK_SEED_BYTES);
	const publicKey = ed25519.getPublicKey(privateKey);
	const idPrefix = new TextEncoder().encode(`${AUTH_ID_CONTEXT}:`);
	const idInput = new Uint8Array(idPrefix.byteLength + publicKey.byteLength);
	idInput.set(idPrefix, 0);
	idInput.set(publicKey, idPrefix.byteLength);
	const idDigest = await crypto.subtle.digest("SHA-256", idInput);
	return {
		authId: encodeBase64Url(new Uint8Array(idDigest)),
		authPublicKey: encodeBase64Url(publicKey),
		authPrivateKey: privateKey,
	};
}

export async function computeAuthChallengeSignature(input: {
	authPrivateKey: Uint8Array<ArrayBuffer>;
	signaturePayload: string;
}): Promise<string> {
	if (!input.signaturePayload.startsWith(`${AUTH_CHALLENGE_CONTEXT}\n`)) {
		throw new Error("invalid auth challenge payload");
	}
	const payload = new TextEncoder().encode(input.signaturePayload);
	const signature = ed25519.sign(payload, input.authPrivateKey);
	return encodeBase64Url(new Uint8Array(signature));
}
