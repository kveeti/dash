import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
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
				<Dialog.Backdrop className="bg-gray-a4 dark:bg-black-a6 backdrop-blur-[2px] fixed inset-0 transition-opacity duration-80 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				<Dialog.Viewport className="fixed inset-0 flex items-start justify-center overflow-hidden px-2 pt-[14vh] pb-2">
					<Dialog.Popup
						className="bg-gray-1 border-gray-a4 rounded-lg flex max-h-[min(36rem,calc(100dvh-5rem))] w-[calc(100vw-1rem)] max-w-[30rem] origin-top flex-col overflow-hidden border shadow-[0_24px_64px_-12px_rgba(0,0,0,0.2),0_4px_12px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7),0_4px_12px_-4px_rgba(0,0,0,0.4)] transition-[transform,scale,opacity] duration-120 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0"
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
								className="border-gray-a3 w-full border-0 border-b bg-transparent h-11 px-4 text-[13px] outline-none placeholder:text-gray-9"
								placeholder="Type a command or search…"
							/>
							<Dialog.Close className="sr-only">Close</Dialog.Close>

							<ScrollArea.Root className="relative flex max-h-[min(60dvh,24rem)] min-h-0 flex-[0_1_auto] overflow-hidden">
								<ScrollArea.Viewport className="min-h-0 flex-1 overscroll-contain [--command-palette-scroll-fade:3rem] [mask-image:linear-gradient(to_bottom,transparent_0,black_min(var(--command-palette-scroll-fade),var(--scroll-area-overflow-y-start)),black_calc(100%_-_min(var(--command-palette-scroll-fade),var(--scroll-area-overflow-y-end,var(--command-palette-scroll-fade)))),transparent_100%)] [mask-repeat:no-repeat]">
									<ScrollArea.Content style={{ minWidth: "100%" }}>
										<Autocomplete.Empty className="flex min-h-24 items-center justify-center p-4 text-sm text-gray-9 empty:m-0 empty:min-h-0 empty:p-0">
											No results.
										</Autocomplete.Empty>

										<Autocomplete.List className="p-1">
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
																className="flex h-8 cursor-default items-center gap-2 mx-1 px-3 text-[13px] rounded-sm select-none outline-none data-[highlighted]:bg-gray-a3 text-gray-12"
															>
																<span className="min-w-0 truncate">{item.label}</span>
																<span className="ml-auto shrink-0 text-[11px] text-gray-10 num">
																	{item.description ?? item.href ?? ""}
																</span>
															</Autocomplete.Item>
														)}
													</Autocomplete.Collection>
												</Autocomplete.Group>
											)}
										</Autocomplete.List>
									</ScrollArea.Content>
								</ScrollArea.Viewport>
							</ScrollArea.Root>

							<div className="border-gray-a3 flex items-center justify-between gap-3 border-t px-3 py-2 text-[11px] text-gray-10">
								<div className="flex items-center gap-1.5">
									<kbd className="kbd-key">↵</kbd>
									<span>open</span>
									<span className="mx-1 text-gray-a6">·</span>
									<kbd className="kbd-key">↑</kbd>
									<kbd className="kbd-key">↓</kbd>
									<span>navigate</span>
								</div>
								<div className="flex items-center gap-1.5">
									<kbd className="kbd-key">esc</kbd>
									<span>close</span>
								</div>
							</div>
						</Autocomplete.Root>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
