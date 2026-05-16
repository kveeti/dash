import type { TransactionDetails } from "../lib/queries/transactions";
import { useUpdateTransactionQuickEditMutation } from "../lib/queries/transactions";
import { useCategoryOptionsQuery } from "../lib/queries/categories";
import { CategoryCombobox } from "./category-combobox";
import { DatePickerInput } from "./date-picker";
import { SelectedTxTagsPanel } from "./selected-tx-tags-panel";
import { usePendingDisplayValue } from "./use-pending-display-value";

function dateToIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

export function SelectedTxQuickEditPanel({
	tx,
	txId,
}: {
	tx: TransactionDetails;
	txId: string;
}) {
	const categories = useCategoryOptionsQuery();
	const updateQuickEdit = useUpdateTransactionQuickEditMutation();
	const categoryId = usePendingDisplayValue(tx.category_id ?? "");
	const categorizeOn = usePendingDisplayValue(tx.categorize_on ?? "");

	async function updateCategory(nextCategoryId: string) {
		if (updateQuickEdit.isPending) return;
		await categoryId.run(nextCategoryId, () =>
			updateQuickEdit.mutateAsync({
				txId,
				patch: { category_id: nextCategoryId || null },
			}),
		);
	}

	async function updateCategorizeOn(nextCategorizeOn: string | null) {
		if (updateQuickEdit.isPending) return;
		await categorizeOn.run(nextCategorizeOn ?? "", () =>
			updateQuickEdit.mutateAsync({
				txId,
				patch: { categorize_on: nextCategorizeOn },
			}),
		);
	}

	return (
		<div className="space-y-2 px-3">
			<div className="grid grid-cols-2 gap-2">
				<CategoryCombobox
					size="sm"
					value={categoryId.value}
					onChange={updateCategory}
					creatable
					items={
						categories.data?.map((category) => ({
							id: category.id,
							value: category.id,
							label: category.name,
						})) ?? []
					}
					className="w-full"
				/>
				<div className="flex min-w-0 items-start gap-1">
					<DatePickerInput
						size="sm"
						value={categorizeOn.value}
						onChange={(event) =>
							updateCategorizeOn(event.currentTarget.value || null)
						}
						className="min-w-0"
						showWeekNumbers
					/>
					<button
						type="button"
						className="h-8 shrink-0 px-1.5 text-xs text-gray-10 hover:text-gray-12"
						onClick={() => updateCategorizeOn(null)}
						title={`Use transaction date (${dateToIsoDate(tx.date)})`}
					>
						clear
					</button>
				</div>
			</div>
			<SelectedTxTagsPanel tx={tx} txId={txId} unpadded />
		</div>
	);
}
