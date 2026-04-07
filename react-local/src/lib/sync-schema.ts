/**
 * Schema migration pipeline for sync payloads.
 *
 * When pulling items with schema_version < CURRENT, run the chain
 * of migrations to upgrade the payload. The migrated item gets
 * marked dirty so it's re-pushed with the new version.
 *
 * Rules:
 * - Each migration is vN → vN+1, never skip versions.
 * - Migrations must be pure (deterministic, no side effects).
 * - Add new migrations at the end of the chain.
 */

import type { SyncPayload } from "./sync-payload";

export const CURRENT_SCHEMA_VERSION = 1;

type Migration = (payload: SyncPayload) => SyncPayload;

/**
 * Migration chain. Index 0 = v1→v2, index 1 = v2→v3, etc.
 * Currently empty — v1 is the only version.
 */
const migrations: Migration[] = [
	// Example for future use:
	// (payload) => {
	//   if (payload.table === "transactions") {
	//     payload.data.new_field ??= "default";
	//   }
	//   return payload;
	// },
];

/**
 * Migrate a payload from `fromVersion` to CURRENT_SCHEMA_VERSION.
 * Returns null if no migration needed.
 */
export function migratePayload(
	payload: SyncPayload,
	fromVersion: number,
): SyncPayload | null {
	if (fromVersion >= CURRENT_SCHEMA_VERSION) return null;

	let current = payload;
	for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
		const migrate = migrations[v - 1];
		if (!migrate) {
			throw new Error(
				`Missing migration from v${v} to v${v + 1}`,
			);
		}
		current = migrate(current);
	}

	return current;
}
