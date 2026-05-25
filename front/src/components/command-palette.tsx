import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { useEncrypted } from "../encrypted-context";
import { useI18n } from "../providers";
import {
	buildTransactionFtsQuery,
	listTransactions,
} from "../lib/db/transactions";
import { useTransactionWindows } from "./transaction-windows";
import { useCategoryOptionsQuery } from "../lib/queries/categories";
import { useAccountsQuery } from "../lib/queries/accounts";
import {
	useBulkAddTransactionTagMutation,
	useBulkRemoveTransactionTagMutation,
	useCreateTagMutation,
	useTagOptionsQuery,
} from "../lib/queries/tags";
import {
	useBulkDeleteTransactionsMutation,
	useBulkSetCategoryMutation,
	useTransactionBulkEditRowsQuery,
	useTransactionCurrenciesQuery,
} from "../lib/queries/transactions";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
	type UnstableComboboxNode,
} from "./unstable-combobox";
import * as Dialog from "./dialog";
import { Button } from "./button";
import { CommandPaletteContext } from "./command-palette-context";
import { useTransactionSelection } from "./transaction-selection-context";

const emptyTxIds: string[] = [];

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);

	const openCommandPalette = useCallback(() => {
		setOpen(true);
	}, []);

	const value = useMemo(
		() => ({ openCommandPalette }),
		[openCommandPalette],
	);

	return (
		<CommandPaletteContext.Provider value={value}>
			{children}
			<CommandPaletteV2
				open={open}
				onOpenChange={setOpen}
			/>
		</CommandPaletteContext.Provider>
	);
}

interface Item {
	value: string;
	label: string;
	href?: string;
	description?: string;
	searchValue?: string;
	onSelect: () => void;
}

function commandItemToNode(item: Item, closePalette: () => void): UnstableComboboxNode {
	return {
		id: item.value,
		label: item.label,
		description: item.description ?? item.href,
		textValue: item.searchValue ?? item.label,
		keywords: item.href ? [item.href] : undefined,
		onSelect: () => {
			item.onSelect();
			closePalette();
		},
	};
}

function commandItemToAction(
	item: Item,
	closePalette: () => void,
): UnstableComboboxItem {
	return commandItemToNode(item, closePalette) as UnstableComboboxItem;
}

function tagCounts(
	rows: Array<{ tags: Array<{ id: string; name: string }> }>,
) {
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const tag of row.tags) {
			counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
		}
	}
	return counts;
}

function normalizeTagName(name: string) {
	return name.trim().replace(/\s+/g, " ");
}

function uniqueActionIds(txIds: string[]) {
	return Array.from(new Set(txIds)).filter(Boolean);
}

function CommandPaletteV2({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [location, setLocation] = useLocation();
	const { db } = useEncrypted();
	const { f } = useI18n();
	const { openTransaction } = useTransactionWindows();
	const transactionSelection = useTransactionSelection();
	const [confirmDeleteTxIds, setConfirmDeleteTxIds] = useState<string[]>([]);

	const categoriesQuery = useCategoryOptionsQuery();
	const accountsQuery = useAccountsQuery();
	const tagsQuery = useTagOptionsQuery();
	const currenciesQuery = useTransactionCurrenciesQuery();
	const bulkTxIds = location.startsWith("/txs")
		? transactionSelection.selectedTxIds
		: emptyTxIds;
	const bulkRowsQuery = useTransactionBulkEditRowsQuery(bulkTxIds);
	const bulkSetCategory = useBulkSetCategoryMutation();
	const bulkAddTag = useBulkAddTransactionTagMutation();
	const bulkRemoveTag = useBulkRemoveTransactionTagMutation();
	const bulkDelete = useBulkDeleteTransactionsMutation();
	const createTag = useCreateTagMutation();

	const closePalette = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const pages: Item[] = useMemo(
		() => [
			{
				value: "v2-stats",
				label: "Stats",
				description: "/stats",
				onSelect: () => setLocation("/stats"),
			},
			{
				value: "v2-stats-canvas",
				label: "Stats · Canvas",
				description: "/stats?tab=canvas",
				onSelect: () => setLocation("/stats?tab=canvas"),
			},
			{
				value: "v2-stats-explorer",
				label: "Stats · Year explorer",
				description: "/stats?tab=stats-1",
				onSelect: () => setLocation("/stats?tab=stats-1"),
			},
			{
				value: "v2-txs",
				label: "Transactions",
				description: "/txs",
				onSelect: () => setLocation("/txs"),
			},
			{
				value: "v2-review",
				label: "Review queue",
				description: "/txs/review",
				onSelect: () => setLocation("/txs/review"),
			},
			{
				value: "v2-txs-new",
				label: "Import transactions",
				description: "/txs/new",
				onSelect: () => setLocation("/txs/new"),
			},
			{
				value: "v2-link-suggestions",
				label: "Link suggestions",
				description: "/txs/link-suggestions",
				onSelect: () => setLocation("/txs/link-suggestions"),
			},
			{
				value: "v2-cats",
				label: "Categories",
				description: "/cats",
				onSelect: () => setLocation("/cats"),
			},
			{
				value: "v2-accounts",
				label: "Accounts",
				description: "/accounts",
				onSelect: () => setLocation("/accounts"),
			},
			{
				value: "v2-settings",
				label: "Settings",
				description: "/settings",
				onSelect: () => setLocation("/settings"),
			},
		],
		[setLocation],
	);

	const filterActions: Item[] = useMemo(() => {
		const items: Item[] = [
			{
				value: "v2-filter-uncat",
				label: "Filter: uncategorized",
				description: "Open txs",
				searchValue: "filter category uncategorized",
				onSelect: () => setLocation("/txs?uncat=1"),
			},
		];
		for (const cat of categoriesQuery.data ?? []) {
			items.push({
				value: `v2-filter-cat-${cat.id}`,
				label: `Filter: ${cat.name}`,
				searchValue: `filter category ${cat.name}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?cat=${encodeURIComponent(cat.id)}`),
			});
		}
		for (const acc of accountsQuery.data ?? []) {
			items.push({
				value: `v2-filter-acc-${acc.id}`,
				label: `Filter: ${acc.name}`,
				searchValue: `filter account ${acc.name} ${acc.currency}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?acc=${encodeURIComponent(acc.id)}`),
			});
		}
		for (const tag of tagsQuery.data ?? []) {
			items.push({
				value: `v2-filter-tag-${tag.id}`,
				label: `Filter: #${tag.name}`,
				searchValue: `filter tag ${tag.name}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?tags=${encodeURIComponent(tag.id)}`),
			});
		}
		for (const cur of currenciesQuery.data ?? []) {
			items.push({
				value: `v2-filter-cur-${cur}`,
				label: `Filter: ${cur}`,
				searchValue: `filter currency ${cur}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?cur=${encodeURIComponent(cur)}`),
			});
		}
		return items;
	}, [
		setLocation,
		categoriesQuery.data,
		accountsQuery.data,
		tagsQuery.data,
		currenciesQuery.data,
	]);

	const config = useMemo<UnstableComboboxConfig>(
		() => {
			const pageItems = pages.map((item) =>
				commandItemToAction(item, closePalette),
			);
			const filterItems = filterActions.map((item) =>
				commandItemToAction(item, closePalette),
			);
			const selectedTxIds = uniqueActionIds(bulkTxIds);
			const selectedRows = bulkRowsQuery.data ?? [];
			const selectedCount = selectedRows.length || selectedTxIds.length;
			const hasBulkScope = selectedTxIds.length > 0;
			const counts = tagCounts(selectedRows);
			const tagItems =
				tagsQuery.data?.map<UnstableComboboxItem>((tag) => {
					const count = counts.get(tag.id) ?? 0;
					const checked =
						selectedRows.length > 0 && count === selectedRows.length
							? true
							: count > 0
								? "mixed"
								: false;
					return {
						id: `bulk-tag:${tag.id}`,
						label: (
							<>
								<span className="text-gray-8">#</span>
								{tag.name}
							</>
						),
						textValue: tag.name,
						breadcrumb: "tags",
						description: count > 0 ? `${count}/${selectedCount}` : undefined,
						checked,
						multi: true,
						onSelect: () => {
							if (checked === true) {
								void bulkRemoveTag.mutateAsync({
									txIds: selectedTxIds,
									tagId: tag.id,
								});
							} else {
								void bulkAddTag.mutateAsync({
									txIds: selectedTxIds,
									tagId: tag.id,
								});
							}
						},
					};
				}) ?? [];
			const presentTagItems = tagItems
				.filter((item) => item.checked === true || item.checked === "mixed")
				.map<UnstableComboboxItem>((item) => {
					const tagId = item.id.replace("bulk-tag:", "");
					return {
						...item,
						id: `bulk-remove-${item.id}`,
						multi: false,
						checked: false,
						breadcrumb: "remove tag",
						onSelect: () => {
							void bulkRemoveTag
								.mutateAsync({ txIds: selectedTxIds, tagId })
								.then(closePalette);
						},
					};
				});
			const categoryItems: UnstableComboboxItem[] = [
				{
					id: "bulk-category:uncategorized",
					label: "Uncategorized",
					textValue: "uncategorized no category",
					breadcrumb: "category",
					checked:
						selectedRows.length > 0 &&
						selectedRows.every((row) => row.category_id == null),
					onSelect: () => {
						void bulkSetCategory
							.mutateAsync({ txIds: selectedTxIds, categoryId: null })
							.then(closePalette);
					},
				},
				...(categoriesQuery.data?.map<UnstableComboboxItem>((category) => ({
					id: `bulk-category:${category.id}`,
					label: category.name,
					textValue: category.name,
					breadcrumb: "category",
					checked:
						selectedRows.length > 0 &&
						selectedRows.every((row) => row.category_id === category.id),
					onSelect: () => {
						void bulkSetCategory
							.mutateAsync({ txIds: selectedTxIds, categoryId: category.id })
							.then(closePalette);
					},
				})) ?? []),
			];
			const bulkActionItems: UnstableComboboxItem[] = hasBulkScope
				? [
						{
							id: "bulk-action-remove-tag",
							label: "Remove tag",
							description: `${selectedCount} selected`,
							textValue: "remove tag selected transactions bulk edit",
							pageId: "bulk-remove-tags",
						},
						{
							id: "bulk-action-change-tags",
							label: "Change or add tags",
							description: `${selectedCount} selected`,
							textValue: "change add tags selected transactions bulk edit",
							pageId: "bulk-tags",
						},
						{
							id: "bulk-action-change-category",
							label: "Change category",
							description: `${selectedCount} selected`,
							textValue: "change category selected transactions bulk edit",
							pageId: "bulk-categories",
						},
						{
							id: "bulk-action-remove-transactions",
							label: "Remove transactions",
							description: `${selectedCount} selected`,
							textValue: "delete remove selected transactions bulk edit",
							onSelect: () => {
								setConfirmDeleteTxIds(selectedTxIds);
								closePalette();
							},
						},
					]
				: [];
			const rootItems: UnstableComboboxNode[] = [
				...(hasBulkScope
					? [
							{
								type: "group" as const,
								id: "bulk-actions",
								label: `${selectedCount} selected`,
								items: bulkActionItems,
							},
						]
					: []),
				{ type: "group", id: "pages", label: "Pages", items: pageItems },
				{
					type: "group",
					id: "filters",
					label: "Filter transactions",
					items: filterItems,
				},
			];
			const rootSources = [
				...(hasBulkScope
					? [
							localSearchSource({
								id: "bulk-actions",
								label: `${selectedCount} selected`,
								items: bulkActionItems,
							}),
							localSearchSource({
								id: "bulk-tags",
								label: "Bulk tags",
								items: tagItems,
							}),
							localSearchSource({
								id: "bulk-categories",
								label: "Bulk categories",
								items: categoryItems,
							}),
						]
					: []),
				localSearchSource({
					id: "pages",
					label: "Pages",
					items: pageItems,
				}),
				localSearchSource({
					id: "filters",
					label: "Filter transactions",
					items: filterItems,
				}),
				{
					id: "transactions",
					label: "Transactions",
					limit: 8,
					debounceMs: 80,
					enabled: ({ query }) => buildTransactionFtsQuery(query) !== null,
					search: async (query, { signal }) => {
						const result = await listTransactions(db, {
							search: query,
							limit: 8,
						});
						if (signal.aborted) return [];
						return result.transactions.map((tx) => ({
							id: `v2-tx-${tx.id}`,
							label: tx.counter_party,
							description: `${f.longDate.format(tx.date)} · ${f.amount(tx.amount, tx.currency)}`,
							textValue: tx.counter_party,
							onSelect: () => {
								openTransaction(tx.id);
								closePalette();
							},
						}));
					},
				},
			];

			return {
				rootPageId: "root",
				pages: {
					root: {
						id: "root",
						title: "Command palette",
						placeholder: "Type a command or search...",
						empty: "No results",
						items: rootItems,
						search: { sources: rootSources },
					},
					"bulk-remove-tags": {
						id: "bulk-remove-tags",
						title: "Remove tag",
						placeholder: "Filter...",
						empty: "No selected transactions have tags.",
						items: presentTagItems,
						search: {
							sources: [
								localSearchSource({
									id: "bulk-remove-tags",
									items: presentTagItems,
								}),
							],
						},
					},
					"bulk-tags": {
						id: "bulk-tags",
						title: "Change or add tags",
						placeholder: "Filter...",
						empty: "No tags.",
						items: tagItems,
						queryNodes: [
							{
								id: "create-tag",
								placement: "replace-empty",
								when: ({ normalizedQuery, hasExactMatch }) =>
									normalizedQuery.length > 0 &&
									!hasExactMatch((item) => item.textValue ?? ""),
								getNodes: ({ query, normalizedQuery }) => [
									{
										type: "group",
										id: "create-tag",
										label: "Create",
										items: [
											{
												id: `bulk-create-tag:${normalizedQuery}`,
												label: `Create "${normalizeTagName(query)}"`,
												textValue: normalizeTagName(query),
												onSelect: () => {
													void createTag
														.mutateAsync(query)
														.then((tagId) =>
															bulkAddTag.mutateAsync({
																txIds: selectedTxIds,
																tagId,
															}),
														)
														.then(closePalette);
												},
											},
										],
									},
								],
							},
						],
						search: {
							sources: [
								localSearchSource({ id: "bulk-tags", items: tagItems }),
							],
						},
					},
					"bulk-categories": {
						id: "bulk-categories",
						title: "Change category",
						placeholder: "Filter...",
						empty: "No categories.",
						items: categoryItems,
						search: {
							sources: [
								localSearchSource({
									id: "bulk-categories",
									items: categoryItems,
								}),
							],
						},
					},
				},
			};
		},
		[
			bulkAddTag,
			bulkRemoveTag,
			bulkRowsQuery.data,
			bulkSetCategory,
			bulkTxIds,
			categoriesQuery.data,
			closePalette,
			createTag,
			db,
			f,
			filterActions,
			openTransaction,
			pages,
			tagsQuery.data,
		],
	);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				onOpenChange(!open);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange, open]);

	return (
		<>
			<UnstableCombobox
				presentation="dialog"
				open={open}
				onOpenChange={onOpenChange}
				title="Command palette"
				placeholder="Type a command or search..."
				empty="No results"
				config={config}
				dialogClassName="sm:left-1/2 sm:right-auto sm:top-[14vh] sm:w-[calc(100vw-1rem)] sm:max-w-[32rem] sm:-translate-x-1/2"
				trigger={({ open }) => (
					<button
						type="button"
						className="sr-only"
						aria-label="Open command palette"
						aria-expanded={open}
					/>
				)}
			/>
			<Dialog.Root
				open={confirmDeleteTxIds.length > 0}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) setConfirmDeleteTxIds([]);
				}}
			>
				<Dialog.Content>
					<Dialog.Title>remove transactions</Dialog.Title>
					<Dialog.Desc>
						Remove {confirmDeleteTxIds.length} selected transaction
						{confirmDeleteTxIds.length === 1 ? "" : "s"}?
					</Dialog.Desc>
					<div className="mt-5 flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => setConfirmDeleteTxIds([])}
						>
							cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							isLoading={bulkDelete.isPending}
							onClick={() => {
								void bulkDelete
									.mutateAsync(confirmDeleteTxIds)
									.then(() => {
										transactionSelection.clear();
										setConfirmDeleteTxIds([]);
									});
							}}
						>
							remove
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</>
	);
}
