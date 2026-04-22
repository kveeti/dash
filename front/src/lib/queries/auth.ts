import { useQuery } from "@tanstack/react-query";
import {
	computeAuthChallengeSignature,
	deriveAuthMaterialFromSeed,
} from "../crypt";
import { queryKeys } from "./query-keys";

export type Me = { user_id: string };

async function getMe(): Promise<Me | null> {
	const response = await fetch("/api/v1/auth/@me", {
		credentials: "include",
	});
	if (response.status === 401) return null;
	if (response.status !== 200) {
		throw new Error("Error fetching @me");
	}

	const json = await response.json();
	return json as Me;
}

export function useMe() {
	return useQuery({
		queryKey: queryKeys.auth(),
		queryFn: getMe,
	});
}

type ChallengeResponse = {
	challenge_id: string;
	nonce: string;
};

async function registerWithAuthMaterial(input: {
	authId: string;
	authPublicKey: string;
}): Promise<void> {
	const response = await fetch("/api/v1/auth/register", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			auth_id: input.authId,
			auth_public_key: input.authPublicKey,
		}),
	});
	if (response.status !== 200) {
		throw new Error(`register failed (${response.status})`);
	}
}

async function fetchChallenge(authId: string): Promise<ChallengeResponse | null> {
	const response = await fetch("/api/v1/auth/challenge", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ auth_id: authId }),
	});
	if (response.status === 401) return null;
	if (response.status !== 200) {
		throw new Error(`challenge failed (${response.status})`);
	}
	return (await response.json()) as ChallengeResponse;
}

async function verifyChallenge(input: {
	authId: string;
	challengeId: string;
	signature: string;
}): Promise<void> {
	const response = await fetch("/api/v1/auth/verify", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			auth_id: input.authId,
			challenge_id: input.challengeId,
			signature: input.signature,
		}),
	});
	if (response.status !== 200) {
		throw new Error(`verify failed (${response.status})`);
	}
}

export async function loginWithSeed(seed: Uint8Array<ArrayBuffer>): Promise<void> {
	const { authId, authPublicKey, authPrivateKey } = await deriveAuthMaterialFromSeed(seed);
	let challenge = await fetchChallenge(authId);
	if (!challenge) {
		await registerWithAuthMaterial({ authId, authPublicKey });
		challenge = await fetchChallenge(authId);
		if (!challenge) {
			throw new Error("challenge unavailable after register");
		}
	}

	const signature = await computeAuthChallengeSignature({
		authPrivateKey,
		challengeId: challenge.challenge_id,
		nonce: challenge.nonce,
	});
	await verifyChallenge({
		authId,
		challengeId: challenge.challenge_id,
		signature,
	});
}
