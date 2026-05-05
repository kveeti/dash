import { useI18n } from "../providers";
import type { TransactionFlow } from "../lib/queries/transactions";

export function SelectedTxFlowList({
	flows,
	onDeleteFlow,
	onOpenTransaction,
}: {
	flows: TransactionFlow[] | undefined;
	onDeleteFlow: (flowId: string) => void;
	onOpenTransaction: (txId: string) => void;
}) {
	const { f } = useI18n();

	if (!flows?.length) return null;

	return (
		<ul className="text-xs space-y-1">
			{flows.map((flow) => {
				const displayAmount =
					flow.kind === "currency_exchange" &&
					flow.direction === "incoming" &&
					flow.to_amount != null &&
					flow.to_currency
						? {
								amount: flow.to_amount,
								currency: flow.to_currency,
							}
						: {
								amount: flow.amount,
								currency: flow.currency,
							};
				return (
					<li
						key={flow.id}
						className="flex items-start justify-between gap-2"
					>
						<button
							type="button"
							className="min-w-0 truncate text-left hover:underline"
							onClick={() => onOpenTransaction(flow.other_transaction_id)}
						>
							{flow.direction === "incoming" ? "from" : "to"}{" "}
							{flow.other_counter_party}
							<span className="text-gray-10"> · {flow.kind}</span>
						</button>
						<div className="text-right shrink-0">
							<span className="text-gray-10">
								{f.amount(displayAmount.amount, displayAmount.currency)}
							</span>
						</div>
						<button
							type="button"
							className="text-gray-10 hover:text-red-11 shrink-0"
							onClick={() => onDeleteFlow(flow.id)}
						>
							delete
						</button>
					</li>
				);
			})}
		</ul>
	);
}
