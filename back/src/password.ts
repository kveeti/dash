import { base64ToBytes, bytesToBase64, timingSafeEqual } from "./token.ts";

const hashVersions = [PBKDF2_001()];

const defaultHashVersion = hashVersions[0];

export const passwords = {
	hash: async (plaintext: string) => {
		const hash = await defaultHashVersion.hash(plaintext);
		const withVersion = defaultHashVersion.id + "__" + hash;

		return withVersion;
	},
	verify: async (hash: string, plaintext: string) => {
		const hashVersion = hashVersions.find((v) => hash.startsWith(v.id));
		if (!hashVersion) {
			throw new Error("hash not supported");
		}
		const withoutVersion = hash.slice(hashVersion.id.length + 2);

		const isOk = await hashVersion.verify(withoutVersion, plaintext);
		if (isOk !== true) {
			return "failed" as const;
		}

		if (hashVersion.id !== defaultHashVersion.id) {
			return "successRehashNeeded" as const;
		}

		return "success" as const;
	},
};

function PBKDF2_001() {
	const iterations = 4_000_000;
	const keySize = 64;
	const saltSize = 64;
	const hashAlgo = "SHA-512";

	return {
		id: "PBKDF2_001",

		hash: async (plaintext: string) => {
			const hashedPasswordByteCount = 1 + saltSize + keySize;
			const hashedPasswordBytes = new Uint8Array(hashedPasswordByteCount);

			const saltBytes = hashedPasswordBytes.subarray(1, 1 + saltSize);
			const keyBytes = hashedPasswordBytes.subarray(1 + saltSize);

			crypto.getRandomValues(saltBytes);

			const keyMaterial = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(plaintext),
				{ name: "PBKDF2" },
				false,
				["deriveBits"]
			);

			const derivedBits = await crypto.subtle.deriveBits(
				{
					name: "PBKDF2",
					salt: saltBytes,
					iterations: iterations,
					hash: hashAlgo,
				},
				keyMaterial,
				keySize * 8
			);

			keyBytes.set(new Uint8Array(derivedBits));

			return bytesToBase64(hashedPasswordBytes);
		},

		verify: async (hash: string, plaintext: string) => {
			const hashedPasswordBytes = base64ToBytes(hash);
			if (hashedPasswordBytes.length === 0) return false;

			const saltBytes = hashedPasswordBytes.subarray(1, 1 + saltSize);
			const expectedKeyBytes = hashedPasswordBytes.subarray(1 + saltSize);

			const keyMaterial = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(plaintext),
				{ name: "PBKDF2" },
				false,
				["deriveBits"]
			);
			const derivedBits = await crypto.subtle.deriveBits(
				{
					name: "PBKDF2",
					salt: saltBytes,
					iterations: iterations,
					hash: hashAlgo,
				},
				keyMaterial,
				keySize * 8
			);

			return timingSafeEqual(new Uint8Array(derivedBits), expectedKeyBytes);
		},
	};
}
