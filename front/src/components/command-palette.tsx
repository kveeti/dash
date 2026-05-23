import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEncrypted } from "../encrypted-context";
import { useI18n } from "../providers";
import {
	buildTransactionFtsQuery,
	listTransactions,
} from "../lib/db/transactions";
import { queryKeyRoots } from "../lib/queries/query-keys";
import { useTransactionWindows } from "./transaction-windows";
import { useCategoryOptionsQuery } from "../lib/queries/categories";
import { useAccountsQuery } from "../lib/queries/accounts";
import { useTagOptionsQuery } from "../lib/queries/tags";
import { useTransactionCurrenciesQuery } from "../lib/queries/transactions";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
	type UnstableComboboxNode,
} from "./unstable-combobox";

interface Item {
	value: string;
	label: string;
	href?: string;
	description?: string;
	searchValue?: string;
	onSelect: () => void;
}

interface Group {
	value: string;
	items: Item[];
}

function commandItemToNode(item: Item, closePalette: () => void): UnstableComboboxNode {
	return {
		id: item.value,
		label: item.label,
		description: item.description ?? item.href,
		textValue: item.searchValue ?? item.label,
		keywords: item.href ? [item.href] : undefined,
		closeOnSelect: true,
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

export function CommandPaletteV2() {
	const [open, setOpen] = useState(false);
	const [, setLocation] = useLocation();
	const { db } = useEncrypted();
	const { f } = useI18n();
	const { openTransaction } = useTransactionWindows();

	const categoriesQuery = useCategoryOptionsQuery();
	const accountsQuery = useAccountsQuery();
	const tagsQuery = useTagOptionsQuery();
	const currenciesQuery = useTransactionCurrenciesQuery();

	const closePalette = useCallback(() => {
		setOpen(false);
	}, []);

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
			return {
				rootPageId: "root",
				pages: {
					root: {
						id: "root",
						title: "Command palette v2",
						placeholder: "Type a command or search...",
						empty: "No results",
						items: [
							{ type: "group", id: "pages", label: "Pages", items: pageItems },
							{
								type: "group",
								id: "filters",
								label: "Filter transactions",
								items: filterItems,
							},
						],
						search: {
							sources: [
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
									enabled: ({ query }) =>
										buildTransactionFtsQuery(query) !== null,
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
											closeOnSelect: true,
											onSelect: () => {
												openTransaction(tx.id);
												closePalette();
											},
										}));
									},
								},
							],
						},
					},
				},
			};
		},
		[
			closePalette,
			db,
			f,
			filterActions,
			openTransaction,
			pages,
		],
	);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key.toLowerCase() === "l" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<UnstableCombobox
			presentation="dialog"
			open={open}
			onOpenChange={setOpen}
			title="Command palette v2"
			placeholder="Type a command or search..."
			empty="No results"
			config={config}
			showDialogHeader={false}
			dialogClassName="sm:left-1/2 sm:right-auto sm:top-[14vh] sm:w-[calc(100vw-1rem)] sm:max-w-[32rem] sm:-translate-x-1/2"
			trigger={({ open }) => (
				<button
					type="button"
					className="sr-only"
					aria-label="Open command palette v2"
					aria-expanded={open}
				/>
			)}
		/>
	);
}

export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [, setLocation] = useLocation();
	const { db } = useEncrypted();
	const { f } = useI18n();
	const { openTransaction } = useTransactionWindows();
	const transactionSearch = query.trim();
	const canSearchTransactions = buildTransactionFtsQuery(transactionSearch) !== null;

	const transactionsQuery = useQuery({
		queryKey: [
			...queryKeyRoots.transactions,
			"command-palette-search",
			transactionSearch,
		],
		queryFn: () =>
			listTransactions(db, {
				search: transactionSearch,
				limit: 8,
			}),
		enabled: canSearchTransactions,
		placeholderData: keepPreviousData,
	});

	const categoriesQuery = useCategoryOptionsQuery();
	const accountsQuery = useAccountsQuery();
	const tagsQuery = useTagOptionsQuery();
	const currenciesQuery = useTransactionCurrenciesQuery();

	const pages: Item[] = useMemo(
		() => [
			{
				value: "stats",
				label: "Stats",
				description: "/stats",
				onSelect: () => setLocation("/stats"),
			},
			{
				value: "stats-canvas",
				label: "Stats · Canvas",
				description: "/stats?tab=canvas",
				onSelect: () => setLocation("/stats?tab=canvas"),
			},
			{
				value: "stats-explorer",
				label: "Stats · Year explorer",
				description: "/stats?tab=stats-1",
				onSelect: () => setLocation("/stats?tab=stats-1"),
			},
			{
				value: "txs",
				label: "Transactions",
				description: "/txs",
				onSelect: () => setLocation("/txs"),
			},
			{
				value: "review",
				label: "Review queue",
				description: "/txs/review",
				onSelect: () => setLocation("/txs/review"),
			},
			{
				value: "txs-new",
				label: "Import transactions",
				description: "/txs/new",
				onSelect: () => setLocation("/txs/new"),
			},
			{
				value: "link-suggestions",
				label: "Link suggestions",
				description: "/txs/link-suggestions",
				onSelect: () => setLocation("/txs/link-suggestions"),
			},
			{
				value: "cats",
				label: "Categories",
				description: "/cats",
				onSelect: () => setLocation("/cats"),
			},
			{
				value: "accounts",
				label: "Accounts",
				description: "/accounts",
				onSelect: () => setLocation("/accounts"),
			},
			{
				value: "settings",
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
				value: "filter-uncat",
				label: "Filter: uncategorized",
				description: "Open txs",
				onSelect: () => setLocation("/txs?uncat=1"),
			},
		];
		for (const cat of categoriesQuery.data ?? []) {
			items.push({
				value: `filter-cat-${cat.id}`,
				label: `Filter: ${cat.name}`,
				searchValue: `category ${cat.name}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?cat=${encodeURIComponent(cat.id)}`),
			});
		}
		for (const acc of accountsQuery.data ?? []) {
			items.push({
				value: `filter-acc-${acc.id}`,
				label: `Filter: ${acc.name}`,
				searchValue: `account ${acc.name}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?acc=${encodeURIComponent(acc.id)}`),
			});
		}
		for (const tag of tagsQuery.data ?? []) {
			items.push({
				value: `filter-tag-${tag.id}`,
				label: `Filter: #${tag.name}`,
				searchValue: `tag ${tag.name}`,
				description: "Open txs",
				onSelect: () => setLocation(`/txs?tags=${encodeURIComponent(tag.id)}`),
			});
		}
		for (const cur of currenciesQuery.data ?? []) {
			items.push({
				value: `filter-cur-${cur}`,
				label: `Filter: ${cur}`,
				searchValue: `currency ${cur}`,
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

	const transactionItems = useMemo<Item[]>(
		() =>
			transactionsQuery.data?.transactions.map((tx) => ({
				value: `tx-${tx.id}`,
				label: tx.counter_party,
				description: `${f.longDate.format(tx.date)} · ${f.amount(tx.amount, tx.currency)}`,
				searchValue: `${tx.counter_party} ${transactionSearch}`,
				onSelect: () => {
					openTransaction(tx.id);
				},
			})) ?? [],
		[
			f,
			openTransaction,
			transactionSearch,
			transactionsQuery.data?.transactions,
		],
	);

	const groupedItems: Group[] = [
		{ value: "Pages", items: pages },
		{ value: "Filter transactions", items: filterActions },
		...(transactionItems.length
			? [{ value: "Transactions", items: transactionItems }]
			: []),
	];

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (!open) return;

		function onKeyDown(e: KeyboardEvent) {
			if (e.key !== "Escape") return;

			e.preventDefault();
			setOpen(false);
		}

		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [open]);

	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Portal>
								<Dialog.Viewport className="fixed inset-0 flex items-start justify-center overflow-hidden px-2 pt-[14vh] pb-2">
					<Dialog.Popup
						className="bg-gray-2 border-gray-a5 rounded-lg flex max-h-[min(36rem,calc(100dvh-5rem))] w-[calc(100vw-1rem)] max-w-[30rem] origin-center flex-col overflow-hidden border shadow-[0_24px_64px_-12px_rgba(0,0,0,0.2),0_4px_12px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7),0_4px_12px_-4px_rgba(0,0,0,0.4)] transition-[transform,scale,opacity] duration-240 ease-[cubic-bezier(0.05,0.95,0.15,1)] data-[ending-style]:duration-100 data-[ending-style]:ease-in data-[ending-style]:scale-[0.95] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0"
						aria-label="Command palette"
					>
						<Autocomplete.Root
							open
							mode="list"
							items={groupedItems}
							value={query}
							onValueChange={setQuery}
							itemToStringValue={(item: Item) => item.searchValue ?? item.label}
							autoHighlight="always"
							keepHighlight
						>
							<Autocomplete.Input
								className="border-gray-a2 w-full border-0 border-b bg-transparent h-11 px-4 text-[13px] outline-none placeholder:text-gray-9"
								placeholder="Type a command or search…"
							/>
							<Dialog.Close className="sr-only">Close</Dialog.Close>

							<div className="combobox-list-scroll flex max-h-[min(60dvh,24rem)] min-h-0 flex-[0_1_auto] flex-col overflow-x-hidden overflow-y-auto overscroll-contain">
								<Autocomplete.Empty className="flex min-h-24 items-center justify-center p-4 text-sm text-gray-9 empty:m-0 empty:min-h-0 empty:p-0">
									No results.
								</Autocomplete.Empty>

								<Autocomplete.List className="pt-1 pb-1">
											{(group: Group) => (
												<Autocomplete.Group
													key={group.value}
													items={group.items}
												>
													<Autocomplete.GroupLabel className="flex h-7 items-center px-3 text-[10px] uppercase tracking-[0.06em] text-gray-10 select-none font-medium">
														{group.value}
													</Autocomplete.GroupLabel>
													<Autocomplete.Collection>
														{(item: Item) => (
															<Autocomplete.Item
																key={item.value}
																value={item}
																onClick={() => {
																	item.onSelect();
																	setOpen(false);
																	setQuery("");
																}}
																className="flex h-8 cursor-default items-center gap-2 ml-1 mr-0 pl-3 pr-2 text-[13px] rounded-sm select-none outline-none data-[highlighted]:bg-gray-a3 text-gray-12"
															>
																<span className="min-w-0 truncate">{item.label}</span>
																<span className="ml-auto min-w-0 truncate text-[11px] text-gray-10 num">
																	{item.description ?? item.href ?? ""}
																</span>
															</Autocomplete.Item>
														)}
													</Autocomplete.Collection>
												</Autocomplete.Group>
											)}
										</Autocomplete.List>
								</div>

						</Autocomplete.Root>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
