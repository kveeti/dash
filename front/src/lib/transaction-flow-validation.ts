export type TransactionFlowKind =
	| "own_transfer"
	| "allocation"
	| "refund"
	| "currency_exchange";

export type SuggestedTransactionFlow = {
	from_transaction_id: string;
	to_transaction_id: string;
	amount: number;
	currency: string;
	to_amount?: number;
	to_currency?: string;
	kind: TransactionFlowKind;
};

export type FlowEndpoint = {
	id: string;
	amount_minor: number;
	currency: string;
};

export type FlowUsage = {
	from_used_minor: number;
	to_used_minor: number;
};

export function validateTransactionFlowCreate({
	kind,
	fromTx,
	toTx,
	amountMinor,
	currency,
	toAmountMinor,
	toCurrency,
	usage,
}: {
	kind: TransactionFlowKind;
	fromTx: FlowEndpoint;
	toTx: FlowEndpoint;
	amountMinor: number;
	currency: string;
	toAmountMinor: number | null;
	toCurrency: string | null;
	usage: FlowUsage;
}): boolean {
	if (fromTx.id === toTx.id) return false;
	if (amountMinor <= 0) return false;
	if (currency !== fromTx.currency) return false;

	if (kind === "currency_exchange") {
		if (toAmountMinor == null || toAmountMinor <= 0 || !toCurrency) return false;
		if (toCurrency !== toTx.currency) return false;
		if (currency === toCurrency) return false;
		if (fromTx.amount_minor >= 0 || toTx.amount_minor <= 0) return false;
		if (usage.from_used_minor + amountMinor > Math.abs(fromTx.amount_minor)) {
			return false;
		}
		return usage.to_used_minor + toAmountMinor <= toTx.amount_minor;
	}

	if (toAmountMinor != null || toCurrency) return false;
	if (toTx.currency !== currency) return false;

	if (kind === "own_transfer") {
		if (fromTx.amount_minor >= 0 || toTx.amount_minor <= 0) return false;
		if (usage.from_used_minor + amountMinor > Math.abs(fromTx.amount_minor)) {
			return false;
		}
		return usage.to_used_minor + amountMinor <= toTx.amount_minor;
	}

	if (fromTx.amount_minor <= 0 || toTx.amount_minor >= 0) return false;
	if (usage.from_used_minor + amountMinor > fromTx.amount_minor) return false;
	return usage.to_used_minor + amountMinor <= Math.abs(toTx.amount_minor);
}
