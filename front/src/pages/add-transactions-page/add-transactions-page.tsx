import { ImportTransactionsCSV } from "./import-transactions-csv";
import { NewTransactionForm } from "./new-transaction-form";

export function AddTransactionsPage() {
	return (
		<div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-2 pb-16">
			<h1 className="text-[15px] font-medium tracking-[-0.005em]">Import</h1>
			<p className="text-[12px] text-gray-10 mt-0.5">
				Add transactions via CSV upload or one by one.
			</p>

			<div className="mt-8 space-y-8">
				<section>
					<header className="mb-3">
						<h2 className="text-[13px] font-medium text-gray-12">From CSV</h2>
						<p className="text-[11px] text-gray-10 mt-0.5">
							Bank exports and legacy bundles. Duplicates are detected and skipped automatically.
						</p>
					</header>
					<div className="surface surface-bleed px-3 sm:px-4 py-5">
						<ImportTransactionsCSV />
					</div>
				</section>

				<section>
					<header className="mb-3">
						<h2 className="text-[13px] font-medium text-gray-12">Manual entry</h2>
						<p className="text-[11px] text-gray-10 mt-0.5">
							Add a single transaction.
						</p>
					</header>
					<div className="surface surface-bleed px-3 sm:px-4 py-5">
						<NewTransactionForm />
					</div>
				</section>
			</div>
		</div>
	);
}
