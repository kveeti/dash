import {
	useAddTransactionTagMutation,
	useRemoveTransactionTagMutation,
	useTagOptionsQuery,
} from "../lib/queries/tags";
import type { TransactionDetails } from "../lib/queries/transactions";
import { TagMultiCombobox } from "./tag-combobox";
import { usePendingDisplayValue } from "./use-pending-display-value";

function sameIds(a: string[], b: string[]) {
	if (a.length !== b.length) return false;
	const bSet = new Set(b);
	return a.every((id) => bSet.has(id));
}

export function SelectedTxTagsPanel({
	tx,
	txId,
	unpadded = false,
}: {
	tx: TransactionDetails;
	txId: string;
	unpadded?: boolean;
}) {
	const tags = useTagOptionsQuery();
	const addTag = useAddTransactionTagMutation();
	const removeTag = useRemoveTransactionTagMutation();
	const persistedTagIds = tx.tags.map((tag) => tag.id);
	const tagIds = usePendingDisplayValue(persistedTagIds, sameIds);

	return (
		<div className={unpadded ? "" : "px-3"}>
			<TagMultiCombobox
				items={tags.data ?? []}
				value={tagIds.value}
				onChange={async (nextTagIds) => {
					const currentTagIds = tagIds.value;
					await tagIds.run(nextTagIds, async () => {
						const previous = new Set(currentTagIds);
						const next = new Set(nextTagIds);
						const added = nextTagIds.filter((tagId) => !previous.has(tagId));
						const removed = currentTagIds.filter((tagId) => !next.has(tagId));
						await Promise.all([
							...added.map((tagId) => addTag.mutateAsync({ txId, tagId })),
							...removed.map((tagId) =>
								removeTag.mutateAsync({ txId, tagId }),
							),
						]);
					});
				}}
				placeholder="tags..."
				size="sm"
				creatable
			/>
		</div>
	);
}
