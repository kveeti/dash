import { useI18n } from "../providers";
import type { TransactionDetails } from "../lib/queries/transactions";
import type { SelectedTxAmountDisplay } from "./selected-tx-flow-logic";

export function SelectedTxHeader({
	amountDisplay,
	tx,
}: {
	amountDisplay: SelectedTxAmountDisplay;
	tx: TransactionDetails;
}) {
	const { f } = useI18n();
	const isIncome = amountDisplay.amount > 0;

	return (
		<div className="space-y-1 px-3 pt-3">
			<h2 className="font-medium">{tx.counter_party}</h2>
			<p className="flex flex-wrap items-baseline gap-1.5 text-sm">
				<span className={isIncome ? "text-green-11" : ""}>
					{f.amount(amountDisplay.amount, amountDisplay.currency)}
				</span>
				<span className="text-gray-9">·</span>
				<span>{f.weekdayLongDate.format(new Date(tx.date))}</span>
			</p>
			{amountDisplay.original && (
				<p className="text-xs text-gray-11">
					({f.amount(amountDisplay.original.amount, amountDisplay.original.currency)})
				</p>
			)}
			<p className="text-xs text-gray-11">{tx.account_name}</p>
			{tx.additional?.trim() && (
				<p className="whitespace-pre-wrap text-xs text-gray-11">
					{tx.additional}
				</p>
			)}
		</div>
	);
}
