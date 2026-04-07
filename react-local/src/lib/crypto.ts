const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** PBKDF2(passphrase, salt) → master key material (derivable, not directly usable for encrypt) */
export async function deriveMasterKey(
	passphrase: string,
	salt: string,
): Promise<CryptoKey> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(passphrase),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	// Derive 256 bits then import as HKDF base
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: enc.encode(salt),
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		256,
	);
	return crypto.subtle.importKey("raw", bits, "HKDF", false, [
		"deriveBits",
		"deriveKey",
	]);
}

/** HKDF(masterKey, info="auth") → raw bytes to send to server */
export async function deriveAuthKey(masterKey: CryptoKey): Promise<Uint8Array> {
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("auth") },
		masterKey,
		256,
	);
	return new Uint8Array(bits);
}

/** HKDF(masterKey, info="kek") → AES-GCM key for wrapping/unwrapping the DEK */
export async function deriveKek(masterKey: CryptoKey): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("kek") },
		masterKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** Generate a random AES-GCM-256 DEK (extractable so it can be wrapped) */
export async function generateDek(): Promise<CryptoKey> {
	return crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
}

/** AES-GCM encrypt the raw DEK bytes with the KEK. Returns iv (12) + ciphertext. */
export async function wrapDek(
	dek: CryptoKey,
	kek: CryptoKey,
): Promise<Uint8Array> {
	const rawDek = await crypto.subtle.exportKey("raw", dek);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		kek,
		rawDek,
	);
	const result = new Uint8Array(12 + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), 12);
	return result;
}

/** Decrypt wrapped DEK bytes with the KEK, re-import as AES-GCM key */
export async function unwrapDek(
	wrapped: Uint8Array,
	kek: CryptoKey,
): Promise<CryptoKey> {
	const iv = wrapped.slice(0, 12);
	const ciphertext = wrapped.slice(12);
	const rawDek = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		kek,
		ciphertext,
	);
	return crypto.subtle.importKey(
		"raw",
		rawDek,
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
}

/** Encrypt a JSON string with the DEK. Returns base64(iv + ciphertext). */
export async function encryptPayload(
	json: string,
	dek: CryptoKey,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		dek,
		enc.encode(json),
	);
	const blob = new Uint8Array(12 + ciphertext.byteLength);
	blob.set(iv, 0);
	blob.set(new Uint8Array(ciphertext), 12);
	return uint8ToBase64(blob);
}

/** Decrypt a base64(iv + ciphertext) blob with the DEK. Returns plaintext JSON. */
export async function decryptPayload(
	blob: string,
	dek: CryptoKey,
): Promise<string> {
	const bytes = base64ToUint8(blob);
	const iv = bytes.slice(0, 12);
	const ciphertext = bytes.slice(12);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		dek,
		ciphertext,
	);
	return dec.decode(plaintext);
}

// --- base64 helpers ---

function uint8ToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Encode Uint8Array to base64 (exported for use in auth flows) */
export { uint8ToBase64, base64ToUint8 };
