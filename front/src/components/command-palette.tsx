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

	const pages: Item[] = [
		{
			value: "stats", label: "Stats", href: "/stats", onSelect: () => {
				setLocation("/stats");
			}
		},
		{
			value: "txs", label: "Transactions", href: "/txs", onSelect: () => {
				setLocation("/txs");
			}
		},
		{
			value: "txs-new", label: "Add Transactions", href: "/txs/new", onSelect: () => {
				setLocation("/txs/new");
			}
		},
		{
			value: "cats", label: "Categories", href: "/cats", onSelect: () => {
				setLocation("/cats");
			}
		},
		{
			value: "accounts", label: "Accounts", href: "/accounts", onSelect: () => {
				setLocation("/accounts");
			}
		},
		{
			value: "settings", label: "Settings", href: "/settings", onSelect: () => {
				setLocation("/settings");
			}
		},
	];

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
				<Dialog.Backdrop className="bg-gray-a5 dark:bg-black-a8 fixed inset-0 transition-opacity duration-80 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				<Dialog.Viewport className="fixed inset-0 flex items-start justify-center overflow-hidden px-2 pt-18 pb-2">
					<Dialog.Popup
						className="bg-gray-1 border-gray-a5 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[calc(100vw-1rem)] max-w-[28rem] origin-top flex-col overflow-hidden border font-mono transition-[transform,scale,opacity] duration-70 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] data-[ending-style]:scale-99 data-[ending-style]:opacity-0 data-[starting-style]:scale-99 data-[starting-style]:opacity-0"
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
								className="border-gray-a4 w-full border-0 border-b bg-transparent p-3 text-sm outline-none placeholder:text-gray-9"
								placeholder="Go to..."
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
													<Autocomplete.GroupLabel className="flex h-7 items-center px-2 text-xs text-gray-9 select-none">
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
																className="flex h-8 cursor-default items-center gap-2 px-2 text-sm select-none outline-none data-[highlighted]:bg-gray-a3"
															>
																<span className="min-w-0 truncate">{item.label}</span>
																<span className="ml-auto shrink-0 text-xs text-gray-9">
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

							<div className="border-gray-a4 flex items-center gap-3 border-t px-3 py-2 text-xs text-gray-9">
								<span>Select</span>
								<kbd className="border-gray-a5 bg-gray-a2 inline-flex h-5 min-w-5 items-center justify-center border px-1 text-[0.625rem]">
									Enter
								</kbd>
							</div>
						</Autocomplete.Root>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
