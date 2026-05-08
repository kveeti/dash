import { describe, expect, it } from "vitest";
import { buildTransactionFtsQuery } from "./transactions";

describe("buildTransactionFtsQuery", () => {
	it("builds prefix terms from plain text", () => {
		expect(buildTransactionFtsQuery("k super helsinki")).toBe(
			"k* super* helsinki*",
		);
	});

	it("splits punctuation without carrying FTS syntax through", () => {
		expect(buildTransactionFtsQuery('K-Supermarket "foo" OR bar')).toBe(
			"k* supermarket* foo* or* bar*",
		);
	});

	it("returns null for queries without searchable text", () => {
		expect(buildTransactionFtsQuery(" - / ")).toBeNull();
	});
});
