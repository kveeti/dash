export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(passphrase),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function encrypt(data: string, passphrase: string): Promise<Uint8Array> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(passphrase, salt);
	const enc = new TextEncoder();
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		enc.encode(data),
	);
	// Format: salt (16) + iv (12) + ciphertext
	const result = new Uint8Array(16 + 12 + ciphertext.byteLength);
	result.set(salt, 0);
	result.set(iv, 16);
	result.set(new Uint8Array(ciphertext), 28);
	return result;
}

export async function decrypt(blob: Uint8Array, passphrase: string): Promise<string> {
	const salt = blob.slice(0, 16);
	const iv = blob.slice(16, 28);
	const ciphertext = blob.slice(28);
	const key = await deriveKey(passphrase, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(plaintext);
}

