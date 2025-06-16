import { envs } from "./envs.ts";

const authCookieName = "auth";
const dataSplitter = ":";
const signatureSplitter = ".";

export function createAuthCookie(token: string, expiry: Date) {
	const props = [
		authCookieName + "=" + token,
		"Path=/",
		"Max-Age=" + Math.floor((expiry.getTime() - Date.now()) / 1000),
		"HttpOnly",
		"SameSite=Lax",
	];

	if (envs.useSecureCookie) {
		props.push("Secure");
	}

	return props.join("; ") + ";";
}

export function createCsrfCookie(csrf: string) {
	const props = [
		//
		"csrf" + "=" + csrf,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
	];

	if (envs.useSecureCookie) {
		props.push("Secure");
	}

	return props.join("; ") + ";";
}

export async function createToken(userId: string, expiry: Date) {
	const data = userId + dataSplitter + expiry.getTime();

	const signature = await hmacSha256(data, envs.secret);
	const signatureHex = bytesToHex(new Uint8Array(signature));

	return data + signatureSplitter + signatureHex;
}

export async function verifyToken(token: unknown) {
	if (typeof token !== "string") {
		return null;
	}

	const [data, signature] = token.split(signatureSplitter);
	if (!data || !signature) {
		return null;
	}

	const expectedSignature = await hmacSha256(data, envs.secret);
	if (!timingSafeEqual(hexToBytes(signature), expectedSignature)) {
		return null;
	}

	const [userId, expiry] = data.split(dataSplitter);
	if (!userId || !expiry) {
		return null;
	}

	const expiryNum = Number(expiry);
	if (Number.isNaN(expiryNum) && new Date().getTime() > expiryNum) {
		return null;
	}

	return userId;
}

export async function hmacSha256(data: string, key: string) {
	const encoder = new TextEncoder();
	const encodedData = encoder.encode(data);
	const encodedKey = encoder.encode(key);
	const keyBytes = await crypto.subtle.importKey(
		"raw",
		encodedKey,
		{
			name: "HMAC",
			hash: { name: "SHA-256" },
		},
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign("HMAC", keyBytes, encodedData);
	return new Uint8Array(signature);
}

export function timingSafeEqual(aBuffer: Uint8Array, bBuffer: Uint8Array) {
	if (aBuffer.length !== bBuffer.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < aBuffer.length; i++) {
		result |= aBuffer[i] ^ bBuffer[i];
	}

	return result === 0;
}

export function bytesToHex(bytes: Uint8Array) {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function hexToBytes(hex: string) {
	const pairs = hex.match(/.{1,2}/g) || [];
	return new Uint8Array(pairs.map((pair) => parseInt(pair, 16)));
}

export function bytesToBase64(bytes: Uint8Array) {
	let binaryString = "";
	const len = bytes.length;
	for (let i = 0; i < len; i++) {
		binaryString += String.fromCharCode(bytes[i]);
	}
	return btoa(binaryString);
}

export function base64ToBytes(base64: string) {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}
