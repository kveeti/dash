export const CURRENT_PAYLOAD_VERSION = 1;

export type SyncRecordType =
	| "category"
	| "account"
	| "transaction"
	| "transaction_import_key"
	| "transaction_flow";

export type SyncTableName =
	| "categories"
	| "accounts"
	| "transactions"
	| "transaction_import_keys"
	| "transaction_flows";

export type ParsedSyncRecordId = {
	recordType: SyncRecordType;
	tableName: SyncTableName;
	actualId: string;
};

export type SyncPlaintextEnvelope = {
	pv: number;
	id: string;
	d: unknown;
};

export type AccountSyncData = {
	created_at: string;
	updated_at: string | null;
	name: string;
	currency: string;
	external_id: string | null;
};

export type CategorySyncData = {
	created_at: string;
	updated_at: string | null;
	name: string;
	is_neutral: number;
};

export type TransactionSyncData = {
	created_at: string;
	updated_at: string | null;
	date: string;
	amount_minor: number;
	currency: string;
	counter_party: string;
	additional: string | null;
	notes: string | null;
	categorize_on: string | null;
	category_id: string | null;
	account_id: string;
};

export type TransactionImportKeySyncData = {
	transaction_id: string;
	source_type: string;
	source_scope: string;
	key_type: string;
	key_value: string;
	created_at: string;
	last_seen_at: string;
	seen_count: number;
};

export type TransactionFlowSyncData = {
	from_transaction_id: string;
	to_transaction_id: string;
	amount_minor: number;
	currency: string;
	kind: string;
	created_at: string;
	updated_at: string | null;
	notes: string | null;
};

export type DecodedSyncRecord =
	| { recordType: "account"; actualId: string; data: AccountSyncData }
	| { recordType: "category"; actualId: string; data: CategorySyncData }
	| { recordType: "transaction"; actualId: string; data: TransactionSyncData }
	| {
			recordType: "transaction_import_key";
			actualId: string;
			data: TransactionImportKeySyncData;
	  }
	| {
			recordType: "transaction_flow";
			actualId: string;
			data: TransactionFlowSyncData;
	  };

export type SyncAcceptErrorKind =
	| "blocked_payload_version"
	| "unsupported_newer_payload_version"
	| "unsupported_legacy_payload_version"
	| "invalid_schema"
	| "invalid_record_id"
	| "unknown_record_type"
	| "payload_metadata_mismatch";

export class SyncAcceptError extends Error {
	constructor(
		readonly kind: SyncAcceptErrorKind,
		message: string,
		readonly details: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "SyncAcceptError";
	}
}

type SyncSchema<T> = {
	decode: (input: unknown) => T;
};

type SupportedPayloadVersion = {
	status: "supported";
	schemas: {
		account: SyncSchema<AccountSyncData>;
		category: SyncSchema<CategorySyncData>;
		transaction: SyncSchema<TransactionSyncData>;
		transaction_import_key: SyncSchema<TransactionImportKeySyncData>;
		transaction_flow: SyncSchema<TransactionFlowSyncData>;
	};
};

type BlockedPayloadVersion = {
	status: "blocked";
	reason: string;
};

type PayloadVersionEntry = SupportedPayloadVersion | BlockedPayloadVersion;

export function parseSyncRecordId(recordId: string): ParsedSyncRecordId {
	const parts = recordId.split(":");
	if (parts.length !== 2 || !parts[1]) {
		throw new SyncAcceptError("invalid_record_id", "invalid sync record id", {
			recordId,
		});
	}

	const [recordTypeRaw, actualId] = parts;
	switch (recordTypeRaw) {
		case "category":
			return { recordType: recordTypeRaw, tableName: "categories", actualId };
		case "account":
			return { recordType: recordTypeRaw, tableName: "accounts", actualId };
		case "transaction":
			return { recordType: recordTypeRaw, tableName: "transactions", actualId };
		case "transaction_import_key":
			return {
				recordType: recordTypeRaw,
				tableName: "transaction_import_keys",
				actualId,
			};
		case "transaction_flow":
			return {
				recordType: recordTypeRaw,
				tableName: "transaction_flows",
				actualId,
			};
		default:
			throw new SyncAcceptError("unknown_record_type", "unsupported sync record type", {
				recordType: recordTypeRaw,
			});
	}
}

export function decodeSyncRecord(envelope: SyncPlaintextEnvelope): DecodedSyncRecord {
	const { recordType, actualId } = parseSyncRecordId(envelope.id);
	const versionEntry = payloadVersions[envelope.pv];

	if (!versionEntry) {
		if (envelope.pv > CURRENT_PAYLOAD_VERSION) {
			throw new SyncAcceptError(
				"unsupported_newer_payload_version",
				"payload version requires a newer app",
				{ pv: envelope.pv, current: CURRENT_PAYLOAD_VERSION },
			);
		}
		throw new SyncAcceptError(
			"unsupported_legacy_payload_version",
			"payload version is no longer supported",
			{ pv: envelope.pv, current: CURRENT_PAYLOAD_VERSION },
		);
	}

	if (versionEntry.status === "blocked") {
		throw new SyncAcceptError(
			"blocked_payload_version",
			"payload version is blocked",
			{ pv: envelope.pv, reason: versionEntry.reason },
		);
	}

	return {
		recordType,
		actualId,
		data: versionEntry.schemas[recordType].decode(envelope.d),
	} as DecodedSyncRecord;
}

export function validateDirtyPayload(input: {
	id: string;
	pv: number;
	d: unknown;
}): void {
	decodeSyncRecord(input);
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalid(path, "object");
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		throw invalid(path, "plain object");
	}
	return value as Record<string, unknown>;
}

function shape(
	value: unknown,
	path: string,
	keys: readonly string[],
): Record<string, unknown> {
	const o = object(value, path);
	const allowed = new Set(keys);
	for (const key of Object.keys(o)) {
		if (!allowed.has(key)) {
			throw new SyncAcceptError("invalid_schema", "unexpected sync payload field", {
				path: `${path}.${key}`,
			});
		}
	}
	return o;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string") throw invalid(path, "string");
	return value;
}

function nullableString(value: unknown, path: string): string | null {
	if (value === null) return null;
	return string(value, path);
}

function integer(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw invalid(path, "safe integer");
	}
	return value;
}

function invalid(path: string, expected: string): SyncAcceptError {
	return new SyncAcceptError("invalid_schema", "invalid sync payload schema", {
		path,
		expected,
	});
}

const accountV1: SyncSchema<AccountSyncData> = {
	decode(input) {
		const o = shape(input, "account", [
			"created_at",
			"updated_at",
			"name",
			"currency",
			"external_id",
		]);
		return {
			created_at: string(o.created_at, "account.created_at"),
			updated_at: nullableString(o.updated_at, "account.updated_at"),
			name: string(o.name, "account.name"),
			currency: string(o.currency, "account.currency"),
			external_id: nullableString(o.external_id, "account.external_id"),
		};
	},
};

const categoryV1: SyncSchema<CategorySyncData> = {
	decode(input) {
		const o = shape(input, "category", [
			"created_at",
			"updated_at",
			"name",
			"is_neutral",
		]);
		return {
			created_at: string(o.created_at, "category.created_at"),
			updated_at: nullableString(o.updated_at, "category.updated_at"),
			name: string(o.name, "category.name"),
			is_neutral: integer(o.is_neutral, "category.is_neutral"),
		};
	},
};

const transactionV1: SyncSchema<TransactionSyncData> = {
	decode(input) {
		const o = shape(input, "transaction", [
			"created_at",
			"updated_at",
			"date",
			"amount_minor",
			"currency",
			"counter_party",
			"additional",
			"notes",
			"categorize_on",
			"category_id",
			"account_id",
		]);
		return {
			created_at: string(o.created_at, "transaction.created_at"),
			updated_at: nullableString(o.updated_at, "transaction.updated_at"),
			date: string(o.date, "transaction.date"),
			amount_minor: integer(o.amount_minor, "transaction.amount_minor"),
			currency: string(o.currency, "transaction.currency"),
			counter_party: string(o.counter_party, "transaction.counter_party"),
			additional: nullableString(o.additional, "transaction.additional"),
			notes: nullableString(o.notes, "transaction.notes"),
			categorize_on: nullableString(o.categorize_on, "transaction.categorize_on"),
			category_id: nullableString(o.category_id, "transaction.category_id"),
			account_id: string(o.account_id, "transaction.account_id"),
		};
	},
};

const transactionImportKeyV1: SyncSchema<TransactionImportKeySyncData> = {
	decode(input) {
		const o = shape(input, "transaction_import_key", [
			"transaction_id",
			"source_type",
			"source_scope",
			"key_type",
			"key_value",
			"created_at",
			"last_seen_at",
			"seen_count",
		]);
		return {
			transaction_id: string(
				o.transaction_id,
				"transaction_import_key.transaction_id",
			),
			source_type: string(o.source_type, "transaction_import_key.source_type"),
			source_scope: string(o.source_scope, "transaction_import_key.source_scope"),
			key_type: string(o.key_type, "transaction_import_key.key_type"),
			key_value: string(o.key_value, "transaction_import_key.key_value"),
			created_at: string(o.created_at, "transaction_import_key.created_at"),
			last_seen_at: string(o.last_seen_at, "transaction_import_key.last_seen_at"),
			seen_count: integer(o.seen_count, "transaction_import_key.seen_count"),
		};
	},
};

const transactionFlowV1: SyncSchema<TransactionFlowSyncData> = {
	decode(input) {
		const o = shape(input, "transaction_flow", [
			"from_transaction_id",
			"to_transaction_id",
			"amount_minor",
			"currency",
			"kind",
			"created_at",
			"updated_at",
			"notes",
		]);
		return {
			from_transaction_id: string(
				o.from_transaction_id,
				"transaction_flow.from_transaction_id",
			),
			to_transaction_id: string(
				o.to_transaction_id,
				"transaction_flow.to_transaction_id",
			),
			amount_minor: integer(o.amount_minor, "transaction_flow.amount_minor"),
			currency: string(o.currency, "transaction_flow.currency"),
			kind: string(o.kind, "transaction_flow.kind"),
			created_at: string(o.created_at, "transaction_flow.created_at"),
			updated_at: nullableString(o.updated_at, "transaction_flow.updated_at"),
			notes: nullableString(o.notes, "transaction_flow.notes"),
		};
	},
};

const payloadVersions: Record<number, PayloadVersionEntry> = {
	1: {
		status: "supported",
		schemas: {
			account: accountV1,
			category: categoryV1,
			transaction: transactionV1,
			transaction_import_key: transactionImportKeyV1,
			transaction_flow: transactionFlowV1,
		},
	},
};
