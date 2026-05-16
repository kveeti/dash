import { useI18n } from "../providers";
import type {
	SuggestedTransactionFlow,
	TransactionLinkSuggestion,
} from "../lib/queries/transactions";
import { Button } from "./button";
import type { TransactionWindowOrigin } from "./transaction-windows";

export function SelectedTxLinkSuggestions({
	isAccepting,
	isDismissing,
	onAccept,
	onDismiss,
	onOpenTransaction,
	suggestions,
}: {
	isAccepting: boolean;
	isDismissing: boolean;
	onAccept: (flows: SuggestedTransactionFlow[]) => void;
	onDismiss: (suggestion: TransactionLinkSuggestion) => void;
	onOpenTransaction: (txId: string, origin?: TransactionWindowOrigin) => void;
	suggestions: TransactionLinkSuggestion[] | undefined;
}) {
	const { f } = useI18n();

	if (!suggestions?.length) return null;

	return (
		<div className="border-gray-a4 border p-2 text-xs space-y-2">
			<p className="text-gray-11">possible links</p>
			<ul className="space-y-2">
				{suggestions.map((suggestion) => {
					const candidates = suggestion.transactions.filter(
						(item) => item.id !== suggestion.primary_transaction_id,
					);
					if (candidates.length === 0) return null;
					return (
						<li key={suggestion.id} className="space-y-1">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="truncate">{suggestion.reason}</p>
									<ul className="text-gray-10">
										{candidates.map((candidate) => (
											<li key={candidate.id}>
												<button
													type="button"
													className="max-w-full truncate text-left hover:text-gray-12 hover:underline"
													onClick={(event) => {
														const rect =
															event.currentTarget.getBoundingClientRect();
														onOpenTransaction(candidate.id, {
															top: rect.top,
															right: rect.right,
														});
													}}
												>
													{candidate.counter_party}{" "}
													{f.amount(candidate.amount, candidate.currency)}
												</button>
											</li>
										))}
									</ul>
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										size="sm"
										onClick={() => onAccept(suggestion.suggested_flows)}
										aria-busy={isAccepting}
									>
										link
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => onDismiss(suggestion)}
										aria-busy={isDismissing}
									>
										dismiss
									</Button>
								</div>
							</div>
							<p className="text-gray-10">
								{suggestion.evidence.join(", ")}
							</p>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
