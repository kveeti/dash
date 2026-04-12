const IV_BYTES = 12;

export type SyncPayloadCodec = {
	encode: (payload: Record<string, unknown>) => Promise<string>;
	encodeJsonString: (payload: string) => Promise<string>;
	decode: (blob: string) => Promise<Record<string, unknown> | null>;
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
		async encode(payload): Promise<string> {
			return JSON.stringify(payload);
		},
		async decode(blob): Promise<Record<string, unknown> | null> {
			return parseJsonObjectBlob(blob);
		},
	};
}

export function createDekSyncPayloadCodec(dek: CryptoKey): SyncPayloadCodec {
	async function encodeJsonString(payload: string): Promise<string> {
		const plaintext = new TextEncoder().encode(payload);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext);
		const packed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
		packed.set(iv, 0);
		packed.set(new Uint8Array(ciphertext), IV_BYTES);
		return encodeBase64(packed);
	};

	return {
		async encode(payload): Promise<string> {
			return encodeJsonString(JSON.stringify(payload));
		},

		encodeJsonString,

		async decode(blob): Promise<Record<string, unknown> | null> {
			try {
				const packed = decodeBase64(blob);
				if (packed.byteLength <= IV_BYTES) return null;
				const iv = packed.slice(0, IV_BYTES);
				const ciphertext = packed.slice(IV_BYTES);
				const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext);
				return parseJsonObjectBlob(new TextDecoder().decode(plaintext));
			} catch {
				return null;
			}
		},
	};
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (!value.trim()) {
		throw new Error('base64 payload must be non-empty');
	}
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
