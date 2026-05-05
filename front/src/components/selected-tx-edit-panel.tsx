import { AnimatePresence, motion } from "framer-motion";
import type { TransactionDetails } from "../lib/queries/transactions";
import { useUpdateTransactionMutation } from "../lib/queries/transactions";
import { Button } from "./button";
import { TransactionForm } from "./transaction-form";

export function SelectedTxEditPanel({
	open,
	tx,
	txId,
	onClose,
}: {
	open: boolean;
	tx: TransactionDetails;
	txId: string;
	onClose: () => void;
}) {
	const updateTransaction = useUpdateTransactionMutation();

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
					<div className="px-3">
						<TransactionForm
							defaultValues={{
								date: tx.date,
								amount: tx.amount,
								currency: tx.currency,
								counter_party: tx.counter_party,
								additional: tx.additional ?? undefined,
								notes: tx.notes ?? undefined,
								category_id: tx.category_id ?? undefined,
								account_id: tx.account_id,
							}}
							isSubmitting={updateTransaction.isPending}
							onSubmit={async (values) => {
								await updateTransaction.mutateAsync({ txId, tx: values });
								onClose();
							}}
							actions={
								<>
									<Button
										type="button"
										variant="ghost"
										disabled={updateTransaction.isPending}
										onClick={onClose}
									>
										cancel
									</Button>
									<Button
										type="submit"
										isLoading={updateTransaction.isPending}
										disabled={updateTransaction.isPending}
									>
										save
									</Button>
								</>
							}
						/>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
