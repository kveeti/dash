import type {
	TransactionDetails,
	TransactionFlow,
	TransactionFlowKind,
} from "../lib/queries/transactions";

export type SelectedTxAmountDisplay = {
	amount: number;
	currency: string;
	original: { amount: number; currency: string } | null;
};

export function resolveAmountDisplay(tx: {
	amount: number;
	currency: string;
	converted_amount: number | null;
	converted_currency: string;
}): SelectedTxAmountDisplay {
	if (tx.converted_amount == null) {
		return {
			amount: tx.amount,
			currency: tx.currency,
			original: null,
		};
	}

	const convertedCurrency = tx.converted_currency;
	const wasConverted = tx.currency !== convertedCurrency;

	return {
		amount: tx.converted_amount,
		currency: convertedCurrency,
		original: wasConverted
			? { amount: tx.amount, currency: tx.currency }
			: null,
	};
}

export function sumFlowAmounts(
	flows: TransactionFlow[] | undefined,
	predicate: (flow: TransactionFlow) => boolean,
) {
	return (flows ?? []).reduce(
		(total, flow) => total + (predicate(flow) ? flow.amount : 0),
		0,
	);
}

export function flowAmountForTransaction(flow: TransactionFlow) {
	if (flow.kind === "currency_exchange" && flow.direction === "incoming") {
		return flow.to_amount ?? 0;
	}
	return flow.amount;
}

export function getAvailableFlowAmount(
	tx: TransactionDetails | undefined,
	flows: TransactionFlow[] | undefined,
	kind: TransactionFlowKind,
) {
	if (!tx) return 0;
	if (kind === "own_transfer" || kind === "currency_exchange") {
		const moved = (flows ?? []).reduce(
			(total, flow) =>
				total + (flow.kind === kind ? flowAmountForTransaction(flow) : 0),
			0,
		);
		return Math.max(0, Math.abs(tx.amount) - moved);
	}

	if (tx.amount > 0) {
		const used = sumFlowAmounts(
			flows,
			(flow) =>
				flow.direction === "outgoing" &&
				(flow.kind === "allocation" || flow.kind === "refund"),
		);
		return Math.max(0, tx.amount - used);
	}

	const covered = sumFlowAmounts(
		flows,
		(flow) =>
			flow.direction === "incoming" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	return Math.max(0, Math.abs(tx.amount) - covered);
}

export function inferFlowDirection({
	selected,
	target,
	kind,
}: {
	selected: TransactionDetails;
	target: TransactionDetails;
	kind: TransactionFlowKind;
}) {
	if (kind === "own_transfer") {
		if (selected.amount < 0 && target.amount > 0) {
			return {
				from_transaction_id: selected.id,
				to_transaction_id: target.id,
			};
		}
		if (selected.amount > 0 && target.amount < 0) {
			return {
				from_transaction_id: target.id,
				to_transaction_id: selected.id,
			};
		}
		return null;
	}

	if (kind === "currency_exchange") {
		if (selected.amount < 0 && target.amount > 0) {
			return {
				from_transaction_id: selected.id,
				to_transaction_id: target.id,
			};
		}
		if (selected.amount > 0 && target.amount < 0) {
			return {
				from_transaction_id: target.id,
				to_transaction_id: selected.id,
			};
		}
		return null;
	}

	if (selected.amount > 0 && target.amount < 0) {
		return {
			from_transaction_id: selected.id,
			to_transaction_id: target.id,
		};
	}
	if (selected.amount < 0 && target.amount > 0) {
		return {
			from_transaction_id: target.id,
			to_transaction_id: selected.id,
		};
	}
	return null;
}
