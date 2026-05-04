import { describe, expect, test } from "vitest";
import { validateTransactionFlowCreate } from "./transaction-flow-validation";

const eurOut = { id: "eur-out", amount_minor: -10500, currency: "EUR" };
const plnIn = { id: "pln-in", amount_minor: 43000, currency: "PLN" };
const eurIn = { id: "eur-in", amount_minor: 10000, currency: "EUR" };
const eurExpense = { id: "eur-expense", amount_minor: -4000, currency: "EUR" };

describe("validateTransactionFlowCreate", () => {
	test("accepts a partial cross-currency exchange", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "currency_exchange",
				fromTx: eurOut,
				toTx: plnIn,
				amountMinor: 10000,
				currency: "EUR",
				toAmountMinor: 43000,
				toCurrency: "PLN",
				usage: { from_used_minor: 0, to_used_minor: 0 },
			}),
		).toBe(true);
	});

	test("rejects exchange amounts that exceed the outgoing side", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "currency_exchange",
				fromTx: eurOut,
				toTx: plnIn,
				amountMinor: 10000,
				currency: "EUR",
				toAmountMinor: 43000,
				toCurrency: "PLN",
				usage: { from_used_minor: 600, to_used_minor: 0 },
			}),
		).toBe(false);
	});

	test("rejects exchange amounts that exceed the incoming side", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "currency_exchange",
				fromTx: eurOut,
				toTx: plnIn,
				amountMinor: 10000,
				currency: "EUR",
				toAmountMinor: 43000,
				toCurrency: "PLN",
				usage: { from_used_minor: 0, to_used_minor: 1 },
			}),
		).toBe(false);
	});

	test("rejects same-currency exchange flows", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "currency_exchange",
				fromTx: eurOut,
				toTx: eurIn,
				amountMinor: 10000,
				currency: "EUR",
				toAmountMinor: 10000,
				toCurrency: "EUR",
				usage: { from_used_minor: 0, to_used_minor: 0 },
			}),
		).toBe(false);
	});

	test("rejects exchange fields on same-currency allocations", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "allocation",
				fromTx: eurIn,
				toTx: eurExpense,
				amountMinor: 2000,
				currency: "EUR",
				toAmountMinor: 2000,
				toCurrency: "EUR",
				usage: { from_used_minor: 0, to_used_minor: 0 },
			}),
		).toBe(false);
	});

	test("rejects allocation totals that exceed either side", () => {
		expect(
			validateTransactionFlowCreate({
				kind: "refund",
				fromTx: eurIn,
				toTx: eurExpense,
				amountMinor: 3000,
				currency: "EUR",
				toAmountMinor: null,
				toCurrency: null,
				usage: { from_used_minor: 8000, to_used_minor: 0 },
			}),
		).toBe(false);
	});
});
