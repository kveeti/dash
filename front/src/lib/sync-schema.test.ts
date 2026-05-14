import { describe, expect, test } from "vitest";
import {
	CURRENT_PAYLOAD_VERSION,
	SyncAcceptError,
	decodeSyncRecord,
} from "./sync-schema";

const baseFlow = {
	from_transaction_id: "from-tx",
	to_transaction_id: "to-tx",
	amount_minor: 10000,
	currency: "EUR",
	kind: "currency_exchange",
	created_at: "2026-05-04T00:00:00.000Z",
	updated_at: null,
	notes: null,
};

function decodeFlow(d: Record<string, unknown>) {
	return decodeSyncRecord({
		pv: CURRENT_PAYLOAD_VERSION,
		id: "transaction_flow:flow-id",
		d,
	});
}

function expectInvalidSchema(fn: () => unknown) {
	try {
		fn();
		throw new Error("expected invalid schema");
	} catch (err) {
		expect(err).toBeInstanceOf(SyncAcceptError);
		expect((err as SyncAcceptError).kind).toBe("invalid_schema");
	}
}

describe("transaction flow sync schema", () => {
	test("accepts currency exchange flow payloads", () => {
		const decoded = decodeFlow({
			...baseFlow,
			to_amount_minor: 43000,
			to_currency: "PLN",
		});

		expect(decoded.recordType).toBe("transaction_flow");
		expect(decoded.data.kind).toBe("currency_exchange");
		expect(decoded.data.to_amount_minor).toBe(43000);
		expect(decoded.data.to_currency).toBe("PLN");
	});

	test("rejects currency exchange without a positive target amount", () => {
		expectInvalidSchema(() =>
			decodeFlow({
				...baseFlow,
				to_amount_minor: 0,
				to_currency: "PLN",
			}),
		);
	});

	test("rejects currency exchange without target currency", () => {
		expectInvalidSchema(() =>
			decodeFlow({
				...baseFlow,
				to_amount_minor: 43000,
				to_currency: null,
			}),
		);
	});

	test("rejects exchange-only fields on non-exchange flows", () => {
		expectInvalidSchema(() =>
			decodeFlow({
				...baseFlow,
				kind: "own_transfer",
				to_amount_minor: 43000,
				to_currency: "PLN",
			}),
		);
	});

	test("rejects non-positive flow amounts", () => {
		expectInvalidSchema(() =>
			decodeFlow({
				...baseFlow,
				amount_minor: 0,
				to_amount_minor: 43000,
				to_currency: "PLN",
			}),
		);
	});
});

describe("tag sync schema", () => {
	test("accepts tag payloads", () => {
		const decoded = decodeSyncRecord({
			pv: CURRENT_PAYLOAD_VERSION,
			id: "tag:tag-id",
			d: {
				created_at: "2026-05-14T00:00:00.000Z",
				updated_at: null,
				name: "Japan 2026",
			},
		});

		expect(decoded.recordType).toBe("tag");
		expect(decoded.data.name).toBe("Japan 2026");
	});

	test("accepts transaction tag payloads", () => {
		const decoded = decodeSyncRecord({
			pv: CURRENT_PAYLOAD_VERSION,
			id: "transaction_tag:tx-id_tag-id",
			d: {
				transaction_id: "tx-id",
				tag_id: "tag-id",
				created_at: "2026-05-14T00:00:00.000Z",
				updated_at: null,
			},
		});

		expect(decoded.recordType).toBe("transaction_tag");
		expect(decoded.data.transaction_id).toBe("tx-id");
		expect(decoded.data.tag_id).toBe("tag-id");
	});
});
