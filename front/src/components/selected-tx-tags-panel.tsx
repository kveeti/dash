import { useState } from "react";
import {
	useAddTransactionTagMutation,
	useRemoveTransactionTagMutation,
	useTagOptionsQuery,
} from "../lib/queries/tags";
import type { TransactionDetails } from "../lib/queries/transactions";
import { TagMultiCombobox } from "./tag-combobox";

function sameIds(a: string[], b: string[]) {
	if (a.length !== b.length) return false;
	const bSet = new Set(b);
	return a.every((id) => bSet.has(id));
}

export function SelectedTxTagsPanel({
	tx,
	txId,
}: {
	tx: TransactionDetails;
	txId: string;
}) {
	const tags = useTagOptionsQuery();
	const addTag = useAddTransactionTagMutation();
	const removeTag = useRemoveTransactionTagMutation();
	const [pendingTagIds, setPendingTagIds] = useState<string[] | null>(null);
	const persistedTagIds = tx.tags.map((tag) => tag.id);
	const pendingResolved = pendingTagIds && sameIds(pendingTagIds, persistedTagIds);
	const tagIds = pendingTagIds && !pendingResolved ? pendingTagIds : persistedTagIds;

	return (
		<div className="px-3">
			<TagMultiCombobox
				items={tags.data ?? []}
				value={tagIds}
				onChange={async (nextTagIds) => {
					setPendingTagIds(nextTagIds);
					const previous = new Set(tagIds);
					const next = new Set(nextTagIds);
					const added = nextTagIds.filter((tagId) => !previous.has(tagId));
					const removed = tagIds.filter((tagId) => !next.has(tagId));
					try {
						await Promise.all([
							...added.map((tagId) => addTag.mutateAsync({ txId, tagId })),
							...removed.map((tagId) =>
								removeTag.mutateAsync({ txId, tagId }),
							),
						]);
					} catch (error) {
						setPendingTagIds(null);
						throw error;
					}
				}}
				placeholder="tags..."
				size="sm"
				creatable
			/>
		</div>
	);
}
