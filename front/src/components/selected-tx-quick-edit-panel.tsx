import { useState } from "react";
import type { TransactionDetails } from "../lib/queries/transactions";
import { useUpdateTransactionQuickEditMutation } from "../lib/queries/transactions";
import { useCategoryOptionsQuery } from "../lib/queries/categories";
import { CategoryCombobox } from "./category-combobox";
import { DatePickerInput } from "./date-picker";
import { SelectedTxTagsPanel } from "./selected-tx-tags-panel";

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
	const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
	const [pendingCategorizeOn, setPendingCategorizeOn] = useState<string | null>(null);
	const pendingCategoryResolved =
		pendingCategoryId !== null && (tx.category_id ?? "") === pendingCategoryId;
	const pendingCategorizeOnResolved =
		pendingCategorizeOn !== null &&
		(tx.categorize_on ?? "") === pendingCategorizeOn;
	const categoryId = pendingCategoryResolved
		? tx.category_id ?? ""
		: pendingCategoryId ?? tx.category_id ?? "";
	const categorizeOn = pendingCategorizeOnResolved
		? tx.categorize_on ?? ""
		: pendingCategorizeOn ?? tx.categorize_on ?? "";

	async function updateCategory(nextCategoryId: string) {
		if (updateQuickEdit.isPending) return;
		setPendingCategoryId(nextCategoryId);
		try {
			await updateQuickEdit.mutateAsync({
				txId,
				patch: { category_id: nextCategoryId || null },
			});
		} catch (error) {
			setPendingCategoryId(null);
			throw error;
		}
	}

	async function updateCategorizeOn(nextCategorizeOn: string | null) {
		if (updateQuickEdit.isPending) return;
		setPendingCategorizeOn(nextCategorizeOn ?? "");
		try {
			await updateQuickEdit.mutateAsync({
				txId,
				patch: { categorize_on: nextCategorizeOn },
			});
		} catch (error) {
			setPendingCategorizeOn(null);
			throw error;
		}
	}

	return (
		<div className="space-y-2 px-3">
			<div className="grid grid-cols-2 gap-2">
				<CategoryCombobox
					size="sm"
					value={categoryId}
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
						value={categorizeOn}
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
