import { ImportTransactionsCSV } from "./import-transactions-csv";
import { NewTransactionForm } from "./new-transaction-form";

export function AddTransactionsPage() {
	return (
		<div className="space-y-10 max-w-120 w-full mx-auto pt-10">
			<h1 className="text-lg">Add transactions</h1>

			<div>
				<h2 className="font-bold mb-2">Import from CSV</h2>
				<ImportTransactionsCSV />
			</div>

			<div>
				<h2 className="font-bold mb-2">Add manually</h2>
				<NewTransactionForm />
			</div>
		</div>
	);
}
