import { AnimatePresence, motion } from "framer-motion";
import type {
	SuggestedTransactionFlow,
	TransactionDetails,
	TransactionLinkSuggestion,
} from "../lib/queries/transactions";
import {
	useCreateTransactionFlowMutation,
	useDeleteTransactionFlowMutation,
	useDismissTransactionLinkSuggestionMutation,
	useTransactionFlowsQuery,
	useTransactionLinkSuggestionsQuery,
} from "../lib/queries/transactions";
import { SelectedTxCreateFlowForm } from "./selected-tx-create-flow-form";
import { SelectedTxFlowList } from "./selected-tx-flow-list";
import { SelectedTxFlowSummary } from "./selected-tx-flow-summary";
import { SelectedTxLinkSuggestions } from "./selected-tx-link-suggestions";

export function SelectedTxLinksPanel({
	open,
	tx,
	txId,
	onOpenTransaction,
}: {
	open: boolean;
	tx: TransactionDetails;
	txId: string;
	onOpenTransaction: (txId: string) => void;
}) {
	const flowsQuery = useTransactionFlowsQuery(txId);
	const linkSuggestionsQuery = useTransactionLinkSuggestionsQuery(txId);
	const createFlowMutation = useCreateTransactionFlowMutation();
	const deleteFlowMutation = useDeleteTransactionFlowMutation();
	const dismissLinkSuggestionMutation = useDismissTransactionLinkSuggestionMutation();

	async function acceptLinkSuggestion(
		flows: SuggestedTransactionFlow[],
	) {
		for (const flow of flows) {
			await createFlowMutation.mutateAsync(flow);
		}
	}

	function dismissLinkSuggestion(suggestion: TransactionLinkSuggestion) {
		dismissLinkSuggestionMutation.mutate({
			kind: suggestion.kind,
			primaryTransactionId: suggestion.primary_transaction_id,
			candidateIds: suggestion.transactions
				.filter((candidate) => candidate.id !== suggestion.primary_transaction_id)
				.map((candidate) => candidate.id),
		});
	}

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ duration: 0.15 }}
					className="overflow-hidden"
				>
					<div className="px-3 space-y-2">
						<div className="border-gray-a4 border p-2 text-xs space-y-2">
							<SelectedTxFlowSummary flows={flowsQuery.data} tx={tx} />
							<SelectedTxCreateFlowForm
								flows={flowsQuery.data}
								tx={tx}
								txId={txId}
							/>
						</div>

						<SelectedTxLinkSuggestions
							isAccepting={createFlowMutation.isPending}
							isDismissing={dismissLinkSuggestionMutation.isPending}
							onAccept={acceptLinkSuggestion}
							onDismiss={dismissLinkSuggestion}
							onOpenTransaction={onOpenTransaction}
							suggestions={linkSuggestionsQuery.data}
						/>

						<SelectedTxFlowList
							flows={flowsQuery.data}
							onDeleteFlow={(flowId) =>
								deleteFlowMutation.mutate({ flowId })
							}
							onOpenTransaction={onOpenTransaction}
						/>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
