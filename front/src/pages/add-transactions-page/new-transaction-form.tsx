import { Button } from "../../components/button";
import { TransactionForm } from "../../components/transaction-form";
import { useCreateTransactionMutation } from "../../lib/queries/transactions";

export function NewTransactionForm() {
	const createTransaction = useCreateTransactionMutation();

	return (
		<TransactionForm
			isSubmitting={createTransaction.isPending}
			onSubmit={async (values) => {
				await createTransaction.mutateAsync(values);
			}}
			actions={(
				<Button
					type="submit"
					className="px-6"
					isLoading={createTransaction.isPending}
					disabled={createTransaction.isPending}
				>
					add
				</Button>
			)}
		/>
	);
}
