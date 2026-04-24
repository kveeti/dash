declare module "wa-sqlite/src/examples/OPFSCoopSyncVFS.js" {
	export class OPFSCoopSyncVFS {
		static create(
			name: string,
			module: any,
			options?: Record<string, unknown>,
		): Promise<any>;
	}
}

declare module "wa-sqlite/src/examples/OPFSWriteAheadVFS.js" {
	export class OPFSWriteAheadVFS {
		static create(
			name: string,
			module: any,
			options?: Record<string, unknown>,
		): Promise<any>;
	}
}
