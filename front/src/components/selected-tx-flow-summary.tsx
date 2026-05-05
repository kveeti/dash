import { useI18n } from "../providers";
import type {
	TransactionDetails,
	TransactionFlow,
} from "../lib/queries/transactions";
import {
	flowAmountForTransaction,
	sumFlowAmounts,
} from "./selected-tx-flow-logic";

export function SelectedTxFlowSummary({
	flows,
	tx,
}: {
	flows: TransactionFlow[] | undefined;
	tx: TransactionDetails;
}) {
	const { f } = useI18n();
	const allocationUsed = sumFlowAmounts(
		flows,
		(flow) =>
			flow.direction === "outgoing" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	const allocationCovered = sumFlowAmounts(
		flows,
		(flow) =>
			flow.direction === "incoming" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	const ownTransferMoved = sumFlowAmounts(
		flows,
		(flow) => flow.kind === "own_transfer",
	);
	const currencyExchangeMoved = sumFlowAmounts(
		flows?.map((flow) =>
			flow.kind === "currency_exchange"
				? { ...flow, amount: flowAmountForTransaction(flow) }
				: flow,
		),
		(flow) => flow.kind === "currency_exchange",
	);
	const txAvailable = Math.max(0, tx.amount > 0 ? tx.amount - allocationUsed : 0);
	const txRemaining = Math.max(
		0,
		tx.amount < 0 ? Math.abs(tx.amount) - allocationCovered : 0,
	);
	const txOverfunded = Math.max(
		0,
		tx.amount < 0 ? allocationCovered - Math.abs(tx.amount) : 0,
	);

	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<p className="text-gray-11">flows</p>
				{tx.amount > 0 ? (
					<p className="text-gray-10">
						available {f.amount(txAvailable, tx.currency)}
					</p>
				) : (
					<p className="text-gray-10">
						covered {f.amount(allocationCovered, tx.currency)} /{" "}
						{f.amount(Math.abs(tx.amount), tx.currency)}
						{txOverfunded > 0
							? `, over ${f.amount(txOverfunded, tx.currency)}`
							: txRemaining > 0
								? `, left ${f.amount(txRemaining, tx.currency)}`
								: ""}
					</p>
				)}
			</div>
			{ownTransferMoved > 0 && (
				<p className="text-gray-10">
					own transfer moved {f.amount(ownTransferMoved, tx.currency)}
				</p>
			)}
			{currencyExchangeMoved > 0 && (
				<p className="text-gray-10">
					exchanged {f.amount(currencyExchangeMoved, tx.currency)}
				</p>
			)}
		</>
	);
}
