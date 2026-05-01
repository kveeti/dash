import { Dexie, type EntityTable } from "dexie";
import type { WrappedDek } from "./crypto";

export type UiStorage = {
	id: string;
	wrapped_master_dek: WrappedDek | null;
	passkey_credential_id: string | null;
	cursor: number | null;
	sync_state: "not_configured" | "enabled" | "paused" | null;
};

export const idb = new Dexie("money") as Dexie & {
	uiStorage: EntityTable<UiStorage, "id">;
};

idb.version(1).stores({
	uiStorage: "id, dek, cursor, sync_state",
});

idb.version(2).stores({
	uiStorage: "id, cursor, sync_state, passkey_credential_id",
});

export const uiStorageDefaults = {
	id: "1",
	wrapped_master_dek: null,
	passkey_credential_id: null,
	cursor: null,
	sync_state: "not_configured",
} satisfies UiStorage;

export async function getUiStorage() {
	return await idb.uiStorage.where("id").equals(uiStorageDefaults.id).first();
}
