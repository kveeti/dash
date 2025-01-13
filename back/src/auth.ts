import argon2 from "argon2";
import type { HonoRequest } from "hono";

import { envs } from "./envs.ts";

const authCookieName = "auth";
const dataSplitter = ":";
const signatureSplitter = ".";

export async function hashPassword(plaintext: string) {
	return await argon2.hash(plaintext);
}

export async function verifyPassword(plaintext: string, hash: string) {
	return await argon2.verify(hash, plaintext);
}

export function createAuthCookie(token: string, expiry: Date, isSecure: boolean) {
	return (
		authCookieName +
		"=" +
		token +
		"; Path=/; Max-Age=" +
		Math.floor((expiry.getTime() - Date.now()) / 1000) +
		"; HttpOnly; SameSite=Lax;" +
		(isSecure ? " Secure;" : "")
	);
}

export async function createToken(userId: string, expiry: Date) {
	const data = userId + dataSplitter + expiry.getTime();

	const signature = await hmacSha256(data, envs.secret);
	const signatureBase64 = arrayBufferToBase64(signature);

	return data + signatureSplitter + signatureBase64;
}

export async function getUserId(req: HonoRequest) {
	const cookie = req.header("Cookie");
	if (!cookie) {
		return null;
	}

	const token = cookie.split(";").find((c) => c.trim().startsWith(authCookieName));
	if (!token) {
		return null;
	}

	const tokenValue = token.split("=")[1];
	if (!tokenValue) {
		return null;
	}

	const tokenData = await verifyToken(tokenValue);
	if (!tokenData) {
		return null;
	}

	const { userId, expiry } = tokenData;
	if (new Date().getTime() > Number(expiry)) {
		return null;
	}

	return userId;
}

function arrayBufferToBase64(bytes: Uint8Array) {
	let binary = "";
	const len = bytes.length;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
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

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a[i]! ^ b[i]!;
	}

	return result === 0;
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
	if (!timingSafeEqual(expectedSignature, expectedSignature)) {
		return null;
	}

	const [userId, expiry] = data.split(dataSplitter);
	if (!userId || !expiry) {
		return null;
	}

	if (new Date().getTime() > Number(expiry)) {
		return null;
	}

	return userId;
}
