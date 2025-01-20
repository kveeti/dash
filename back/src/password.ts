const hashVersions = [PBKDF2_001()];

const defaultHashVersion = hashVersions[0]!;

export const passwords = {
	hash: async (plaintext: string) => {
		const hash = await defaultHashVersion.hash(plaintext);
		return defaultHashVersion.id + "__" + hash;
	},
	verify: async (hash: string, plaintext: string) => {
		const hashVersion = hashVersions.find((v) => hash.startsWith(v.id));
		if (!hashVersion) {
			throw new Error("hash not supported");
		}

		const isOk = hashVersion.verify(hash, plaintext);
		if (!isOk) {
			return "failed" as const;
		}

		if (hashVersion.id !== defaultHashVersion.id) {
			return "successRehashNeeded" as const;
		}

		return "success" as const;
	},
};

function PBKDF2_001() {
	const iterations = 1_000_000;
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

			return btoa(String.fromCharCode(...hashedPasswordBytes));
		},

		verify: async (hash: string, plaintext: string) => {
			const hashedPasswordBytes = Uint8Array.from(hash, (c) => c.charCodeAt(0));
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

			const actualKeyBytes = new Uint8Array(derivedBits);
			const isEqual =
				actualKeyBytes.length === expectedKeyBytes.length &&
				actualKeyBytes.every((byte, i) => byte === expectedKeyBytes[i]);
			if (!isEqual) return false;

			return true;
		},
	};
}
