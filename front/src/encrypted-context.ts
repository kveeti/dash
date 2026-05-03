import { createContext, useContext } from "react";
import type { DbClient } from "./lib/db";

export type EncryptedContextValue = {
	status: "ready";
	db: DbClient;
	accountRootKey: Uint8Array<ArrayBuffer>;
	syncContentKey: CryptoKey;
	sqliteKeyHex: string;
};

export const EncryptedContext =
	createContext<EncryptedContextValue | null>(null);

export function useEncrypted() {
	const context = useContext(EncryptedContext);
	if (!context) {
		throw new Error("useEncrypted must be used inside EncryptedProvider");
	}
	return context;
}
