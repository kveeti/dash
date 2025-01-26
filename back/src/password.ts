import { timingSafeEqual } from "./token.ts";

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
		if (isOk === false) {
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

			return bufferToBase64(hashedPasswordBytes);
		},

		verify: async (hash: string, plaintext: string) => {
			const hashedPasswordBytes = base64ToBuffer(hash);
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

			return timingSafeEqual(actualKeyBytes, expectedKeyBytes);
		},
	};
}

function bufferToBase64(buffer: Uint8Array) {
	return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64: string) {
	let binaryString = null;
	try {
		binaryString = atob(base64);
	} catch (_) {
		return new Uint8Array();
	}

	const length = binaryString.length;
	const buffer = new ArrayBuffer(length);
	const view = new Uint8Array(buffer);
	for (let i = 0; i < length; i++) {
		view[i] = binaryString.charCodeAt(i);
	}
	return view;
}
