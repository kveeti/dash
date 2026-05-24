import { useCallback, useEffect, useMemo, useState } from "react";
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
			if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
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
