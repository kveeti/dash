import {
	deriveMasterKey,
	deriveAuthKey,
	deriveKek,
	generateDek,
	wrapDek,
	unwrapDek,
	uint8ToBase64,
	base64ToUint8,
} from "./crypto";

const LS_USER_ID = "dash_sync_user_id";
const LS_TOKEN = "dash_sync_token";
const LS_SERVER_SALT = "dash_sync_server_salt";

export interface SyncAuth {
	userId: string;
	token: string;
	serverSalt: string;
	dek: CryptoKey;
}

/** Read persisted auth identifiers (no DEK — that requires passphrase) */
export function getPersistedAuth(): {
	userId: string;
	token: string;
	serverSalt: string;
} | null {
	const userId = localStorage.getItem(LS_USER_ID);
	const token = localStorage.getItem(LS_TOKEN);
	const serverSalt = localStorage.getItem(LS_SERVER_SALT);
	if (!userId || !token || !serverSalt) return null;
	return { userId, token, serverSalt };
}

/** Persist auth identifiers after signup/login */
export function persistAuth(userId: string, token: string, serverSalt: string) {
	localStorage.setItem(LS_USER_ID, userId);
	localStorage.setItem(LS_TOKEN, token);
	localStorage.setItem(LS_SERVER_SALT, serverSalt);
}

/** Clear all persisted auth state */
export function clearAuth() {
	localStorage.removeItem(LS_USER_ID);
	localStorage.removeItem(LS_TOKEN);
	localStorage.removeItem(LS_SERVER_SALT);
}

/** Update just the token (e.g. after refresh) */
export function persistToken(token: string) {
	localStorage.setItem(LS_TOKEN, token);
}

/**
 * Signup flow:
 * 1. Generate random server_salt
 * 2. Derive master_key → auth_key + KEK
 * 3. Generate DEK, wrap with KEK
 * 4. POST /auth/signup with { server_salt, auth_key, encrypted_dek }
 * 5. Persist auth, return SyncAuth with DEK in memory
 */
export async function signup(
	passphrase: string,
	serverUrl: string,
): Promise<SyncAuth> {
	const serverSalt = uint8ToBase64(crypto.getRandomValues(new Uint8Array(32)));

	const masterKey = await deriveMasterKey(passphrase, serverSalt);
	const authKeyBytes = await deriveAuthKey(masterKey);
	const kek = await deriveKek(masterKey);

	const dek = await generateDek();
	const wrappedDek = await wrapDek(dek, kek);

	const res = await fetch(`${serverUrl}/auth/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			server_salt: serverSalt,
			auth_key: uint8ToBase64(authKeyBytes),
			encrypted_dek: uint8ToBase64(wrappedDek),
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Signup failed: ${text}`);
	}

	const data: { user_id: string; token: string } = await res.json();
	persistAuth(data.user_id, data.token, serverSalt);

	return { userId: data.user_id, token: data.token, serverSalt, dek };
}

/**
 * Login flow:
 * 1. GET /auth/salt/:user_id → server_salt
 * 2. Derive master_key → auth_key + KEK
 * 3. POST /auth/login with { user_id, auth_key }
 * 4. Unwrap encrypted_dek with KEK
 * 5. Persist auth, return SyncAuth with DEK in memory
 */
export async function login(
	userId: string,
	passphrase: string,
	serverUrl: string,
): Promise<SyncAuth> {
	// 1. Fetch salt
	const saltRes = await fetch(`${serverUrl}/auth/salt/${userId}`);
	if (!saltRes.ok) throw new Error("Failed to fetch salt");
	const { server_salt: serverSalt }: { server_salt: string } =
		await saltRes.json();

	// 2. Derive keys
	const masterKey = await deriveMasterKey(passphrase, serverSalt);
	const authKeyBytes = await deriveAuthKey(masterKey);
	const kek = await deriveKek(masterKey);

	// 3. Login
	const loginRes = await fetch(`${serverUrl}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			user_id: userId,
			auth_key: uint8ToBase64(authKeyBytes),
		}),
	});

	if (!loginRes.ok) {
		const text = await loginRes.text();
		throw new Error(`Login failed: ${text}`);
	}

	const data: {
		token: string;
		encrypted_dek: string | null;
		server_salt: string;
	} = await loginRes.json();

	// 4. Unwrap DEK
	if (!data.encrypted_dek) throw new Error("No encrypted DEK on server");
	const dek = await unwrapDek(base64ToUint8(data.encrypted_dek), kek);

	persistAuth(userId, data.token, serverSalt);

	return { userId, token: data.token, serverSalt, dek };
}

/**
 * Unlock flow (already signed up, page reloaded — need passphrase to recover DEK):
 * 1. Read persisted auth from localStorage
 * 2. Derive KEK from passphrase + server_salt
 * 3. Fetch encrypted_dek from server (via login endpoint)
 * 4. Unwrap DEK
 */
export async function unlock(
	passphrase: string,
	serverUrl: string,
): Promise<SyncAuth> {
	const persisted = getPersistedAuth();
	if (!persisted) throw new Error("No persisted auth — signup or login first");

	// Re-derive keys and login to get fresh token + encrypted_dek
	return login(persisted.userId, passphrase, serverUrl);
}
