import { useSearchParams, useLocation } from "wouter";
import { useI18n } from "../../providers";
import {
	useTransactionQuery,
	useTransactionsQuery,
	useUpdateTransactionMutation,
	useBulkSetCategoryMutation,
	useTransactionLinksQuery,
	useLinkTransactionMutation,
	useUnlinkTransactionMutation,
	useTransactionCurrenciesQuery,
	type TransactionRow,
} from "../../lib/queries/transactions";
import { useCategoryOptionsQuery } from "../../lib/queries/categories";
import { useAccountsQuery } from "../../lib/queries/accounts";
import type { TransactionFilters } from "../../lib/queries/query-keys";
import { Empty } from "../../components/empty";
import { Pagination, buildPaginatedHref } from "../../components/pagination";
import {
	Fragment,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { TransactionForm } from "../../components/transaction-form";
import { AnimatePresence, motion } from "framer-motion";
import {
	SelectedTx,
	type SelectedTxHandle,
} from "../../components/selected-tx";

function useFilterParams() {
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();

	const left = searchParams.get("left");
	const right = searchParams.get("right");
	const q = searchParams.get("q") ?? "";
	const categoryId = searchParams.get("cat") ?? "";
	const accountId = searchParams.get("acc") ?? "";
	const currency = searchParams.get("cur") ?? "";
	const uncategorized = searchParams.get("uncat") === "1";

	const filters: TransactionFilters = {};
	if (categoryId) filters.category_id = categoryId;
	if (accountId) filters.account_id = accountId;
	if (currency) filters.currency = currency;
	if (uncategorized) filters.uncategorized = true;

	const hasFilters = !!(q || categoryId || accountId || currency || uncategorized);

	function setParams(updates: Record<string, string | undefined>) {
		const params = new URLSearchParams();
		const current: Record<string, string> = {
			...(q && { q }),
			...(categoryId && { cat: categoryId }),
			...(accountId && { acc: accountId }),
			...(currency && { cur: currency }),
			...(uncategorized && { uncat: "1" }),
		};
		for (const [k, v] of Object.entries({ ...current, ...updates })) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		// reset pagination when filters change
		params.delete("left");
		params.delete("right");
		const qs = params.toString();
		navigate(qs ? `/txs?${qs}` : "/txs");
	}

	// all current filter params for pagination href building
	const filterSearchParams: Record<string, string | undefined> = {
		q: q || undefined,
		cat: categoryId || undefined,
		acc: accountId || undefined,
		cur: currency || undefined,
		uncat: uncategorized ? "1" : undefined,
	};

	return {
		left,
		right,
		q,
		categoryId,
		accountId,
		currency,
		uncategorized,
		filters,
		hasFilters,
		setParams,
		filterSearchParams,
	};
}

function useSelection() {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	function toggle(txId: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(txId)) next.delete(txId);
			else next.add(txId);
			return next;
		});
	}

	function clear() {
		setSelectedIds(new Set());
	}

	return { selectedIds, toggle, clear, isSelecting: selectedIds.size > 0 };
}

function useOpenTxWindows() {
	const [openIds, setOpenIds] = useState<Array<string>>([]);
	const refs = useRef<Map<string, SelectedTxHandle>>(new Map());

	function open(txId: string) {
		if (openIds.includes(txId)) {
			refs.current.get(txId)?.nudge();
			return;
		}
		setOpenIds((p) => [...p, txId]);
	}

	function close(txId: string) {
		setOpenIds((p) => p.filter((id) => id !== txId));
	}

	function setRef(id: string, handle: SelectedTxHandle | null) {
		if (handle) refs.current.set(id, handle);
		else refs.current.delete(id);
	}

	return { openIds, open, close, setRef };
}

function resolveAmountDisplay(
	tx: {
		amount: number;
		currency: string;
		converted_amount: number | null;
		converted_currency: string;
	},
) {
	if (tx.converted_amount == null) {
		return {
			amount: tx.amount,
			currency: tx.currency,
			original: null as { amount: number; currency: string } | null,
		};
	}

	const convertedCurrency = tx.converted_currency;
	const wasConverted = tx.currency !== convertedCurrency;

	return {
		amount: tx.converted_amount,
		currency: convertedCurrency,
		original: wasConverted
			? { amount: tx.amount, currency: tx.currency }
			: null,
	};
}

export function TransactionsPage() {
	const {
		left,
		right,
		q,
		categoryId,
		accountId,
		currency,
		uncategorized,
		filters,
		hasFilters,
		setParams,
		filterSearchParams,
	} = useFilterParams();

	const transactionsQuery = useTransactionsQuery({
		cursor: { left, right },
		search: q || undefined,
		filters: Object.keys(filters).length > 0 ? filters : undefined,
	});

	const { f } = useI18n();

	const categories = useCategoryOptionsQuery();
	const accounts = useAccountsQuery();
	const currencies = useTransactionCurrenciesQuery();

	const selection = useSelection();
	const txWindows = useOpenTxWindows();
	const scrolledForCursor = useRef<string | null>(null);
	const [showFilters, setShowFilters] = useState(hasFilters);

	let currentDay: string | null = null;

	return (
		<>
			<div className="w-full max-w-[35rem] mx-auto pt-4 sm:pt-14 pb-114">
				<div className="flex items-center justify-between">
					<h1 className="font-medium text-2xl font-cool">transactions</h1>
					<button
						type="button"
						className={
							"hidden sm:block text-xs px-2 py-1 hover:bg-gray-a3" +
							(showFilters || hasFilters ? " text-gray-12" : " text-gray-10")
						}
						onClick={() => setShowFilters((v) => !v)}
					>
						{hasFilters ? "filters (on)" : "filters"}
					</button>
				</div>

				{showFilters && (
					<div className="hidden sm:block mt-3 space-y-2">
						<FilterControls
							q={q}
							categoryId={categoryId}
							accountId={accountId}
							currency={currency}
							uncategorized={uncategorized}
							hasFilters={hasFilters}
							categories={categories.data}
							accounts={accounts.data}
							currencies={currencies.data}
							setParams={setParams}
						/>
					</div>
				)}

				<ul className="mt-4">
					{transactionsQuery.data?.transactions.map((tx, i) => {
						const date = new Date(tx.date);
						const day = f.weekdayShortDate.format(date);
						const dayChanged = day !== currentDay;
						currentDay = day;

						const isSelected = selection.selectedIds.has(tx.id);

						return (
							<Fragment key={tx.id}>
								{dayChanged && (
									<div className="sticky top-0 sm:top-10 bg-gray-3 text-xs font-medium py-1.5 px-3 scroll-mt-0 sm:scroll-mt-10">
										{currentDay}
									</div>
								)}

								<TxRow
									tx={tx}
									selected={isSelected}
									selecting={selection.isSelecting}
									onSelect={() => selection.toggle(tx.id)}
									onClick={() => txWindows.open(tx.id)}
									ref={(elem) => {
										const cursorKey = left ?? right;
										if (
											!elem ||
											i !== 0 ||
											!cursorKey ||
											scrolledForCursor.current === cursorKey
										)
											return;
										scrolledForCursor.current = cursorKey;
										elem.scrollIntoView({ block: "start" });
									}}
								/>
							</Fragment>
						);
					})}
				</ul>

				{!transactionsQuery.data?.transactions?.length && (
					<Empty>{hasFilters ? "no results" : "no transactions yet"}</Empty>
				)}
			</div>

			<div
				className={
					"fixed right-0 left-0 max-w-[35rem] mx-auto z-40 pointer-events-none" +
					(selection.isSelecting && showFilters
						? " bottom-40 sm:bottom-12"
						: selection.isSelecting
							? " bottom-32 sm:bottom-12"
							: showFilters
								? " bottom-40 sm:bottom-0"
								: " bottom-16 sm:bottom-0")
				}
			>
				<div className="flex justify-end pb-4">
					<Pagination
						prevHref={buildPaginatedHref(
							"left",
							transactionsQuery.data?.prev_id,
							"/txs",
							filterSearchParams,
						)}
						nextHref={buildPaginatedHref(
							"right",
							transactionsQuery.data?.next_id,
							"/txs",
							filterSearchParams,
						)}
					/>
				</div>
			</div>

			<MobileFilterBar
				showFilters={showFilters}
				setShowFilters={setShowFilters}
				hasFilters={hasFilters}
				q={q}
				categoryId={categoryId}
				accountId={accountId}
				currency={currency}
				uncategorized={uncategorized}
				categories={categories.data}
				accounts={accounts.data}
				currencies={currencies.data}
				setParams={setParams}
			/>

			{selection.isSelecting && (
				<BulkEditBar
					selectedIds={selection.selectedIds}
					onClear={selection.clear}
				/>
			)}

				{txWindows.openIds.map((id, index) => (
					<SelectedTxWindow
						key={id}
						txId={id}
						index={index}
						onClose={() => txWindows.close(id)}
						ref={(handle) => txWindows.setRef(id, handle)}
					/>
			))}
			</>
		);
}

function useLongPress(callback: () => void, ms = 500) {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const firedRef = useRef(false);

	function onStart() {
		firedRef.current = false;
		timerRef.current = setTimeout(() => {
			firedRef.current = true;
			callback();
		}, ms);
	}

	function onEnd() {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}

	return {
		onTouchStart: onStart,
		onTouchEnd: onEnd,
		onTouchMove: onEnd,
		didFire: firedRef,
	};
}

function TxRow(props: {
	tx: TransactionRow;
	selected: boolean;
	selecting: boolean;
	onSelect: () => void;
	onClick: () => void;
	ref: Ref<HTMLLIElement>;
}) {
	const { f } = useI18n();
	const amountDisplay = resolveAmountDisplay(props.tx);
	const isIncome = amountDisplay.amount > 0;

	const longPress = useLongPress(() => {
		props.onSelect();
	});

	return (
		<li ref={props.ref} className="scroll-mt-17">
			<div
				className={
					"flex items-center justify-between gap-3 hover:bg-gray-a3 px-3 py-2 select-none" +
					(props.selected ? " bg-gray-a3" : "")
				}
				onClick={() => {
					if (longPress.didFire.current) return;
					if (props.selecting) {
						props.onSelect();
					} else {
						props.onClick();
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					props.onSelect();
				}}
				onTouchStart={longPress.onTouchStart}
				onTouchEnd={longPress.onTouchEnd}
				onTouchMove={longPress.onTouchMove}
			>
				{props.selecting && (
					<input
						type="checkbox"
						checked={props.selected}
						onChange={props.onSelect}
						onClick={(e) => e.stopPropagation()}
						className="shrink-0"
					/>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate">{props.tx.counter_party}</span>
					</div>
					<div className="mt-0.5 flex gap-3 text-xs">
						{props.tx.category_name && <span>{props.tx.category_name}</span>}
						<span className="text-gray-11">{props.tx.account_name}</span>
					</div>
				</div>
				<div>
					<span
						className={`shrink-0 text-sm ${isIncome ? "text-green-11" : ""}`}
					>
						{f.amount(amountDisplay.amount, amountDisplay.currency)}
					</span>
					{amountDisplay.original && (
						<div className="text-[11px] text-gray-11 leading-tight text-right">
							({f.amount(amountDisplay.original.amount, amountDisplay.original.currency)})
						</div>
					)}
				</div>
			</div>
		</li>
	);
}

function SelectedTxWindow({
	txId,
	index,
	onClose,
	ref: forwardedRef,
}: {
	txId: string;
	index: number;
	onClose: () => void;
	ref?: Ref<SelectedTxHandle>;
}) {
	const { f } = useI18n();
	const [editing, setEditing] = useState(false);
	const [linkInput, setLinkInput] = useState("");
	const [copied, setCopied] = useState(false);
	const selectedTxRef = useRef<SelectedTxHandle>(null);
	const txQuery = useTransactionQuery(txId);
	const updateTransaction = useUpdateTransactionMutation();
	const linksQuery = useTransactionLinksQuery(txId);
	const linkMutation = useLinkTransactionMutation();
	const unlinkMutation = useUnlinkTransactionMutation();

	useImperativeHandle(forwardedRef, () => ({
		nudge: () => selectedTxRef.current?.nudge(),
	}));

	if (!txQuery.data) {
		return;
	}
	const tx = txQuery.data;
	const txAmountDisplay = resolveAmountDisplay(tx);

	const isIncome = txAmountDisplay.amount > 0;
	const stackOffset = { x: 0, y: (index + 1) * 72 };

	function copyId() {
		navigator.clipboard.writeText(txId);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	async function handleLink() {
		const targetId = linkInput.trim();
		if (!targetId || targetId === txId) return;
		await linkMutation.mutateAsync({ aId: txId, bId: targetId });
		setLinkInput("");
	}

	return (
		<SelectedTx
			ref={selectedTxRef}
			id={txId}
			label={`Transaction: ${tx.counter_party}, ${f.amount(txAmountDisplay.amount, txAmountDisplay.currency)}`}
			onClose={onClose}
			initialOffset={stackOffset}
		>
			<div className="space-y-1 px-3 pt-3">
				<h2 className="font-medium">{tx.counter_party}</h2>
				<p className={`text-sm ${isIncome ? "text-green-11" : ""}`}>
					{f.amount(txAmountDisplay.amount, txAmountDisplay.currency)}
				</p>
				{txAmountDisplay.original && (
					<p className="text-xs text-gray-11">
						({f.amount(txAmountDisplay.original.amount, txAmountDisplay.original.currency)})
					</p>
				)}
				<p className="text-xs">{f.weekdayLongDate.format(new Date(tx.date))}</p>
			</div>

			<div className="my-3 space-y-2">
				<div className="flex items-center gap-2 px-3">
					<button
						type="button"
						onClick={() => setEditing(!editing)}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{editing ? "hide edit" : "edit"}
					</button>
					<span className="text-gray-a4">|</span>
					<button
						type="button"
						onClick={copyId}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{copied ? "copied!" : "copy id"}
					</button>
				</div>

				<AnimatePresence>
					{editing && (
						<motion.div
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: "auto", opacity: 1 }}
							exit={{ height: 0, opacity: 0 }}
							transition={{ duration: 0.15 }}
							className="overflow-hidden"
						>
							<div className="px-3">
								<TransactionForm
									defaultValues={{
										date: tx.date,
										amount: tx.amount,
										currency: tx.currency,
										counter_party: tx.counter_party,
										additional: tx.additional ?? undefined,
										notes: tx.notes ?? undefined,
										category_id: tx.category_id ?? undefined,
										account_id: tx.account_id,
									}}
									onSubmit={async (values) => {
										await updateTransaction.mutateAsync({ txId, tx: values });
										setEditing(false);
									}}
									actions={
										<>
											<Button
												type="button"
												variant="ghost"
												onClick={() => setEditing(false)}
											>
												cancel
											</Button>
											<Button type="submit">save</Button>
										</>
									}
								/>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				<div className="px-3 space-y-2">
					<div className="flex gap-1">
						<input
							type="text"
							placeholder="paste tx id to link..."
							value={linkInput}
							onChange={(e) => setLinkInput(e.target.value)}
							className="focus border-gray-6 bg-gray-1 border px-2 h-8 text-sm flex-1 min-w-0"
						/>
						<Button
							size="sm"
							onClick={handleLink}
							disabled={!linkInput.trim() || linkMutation.isPending}
						>
							link
						</Button>
					</div>

						{linksQuery.data && linksQuery.data.length > 0 && (
							<ul className="text-xs space-y-1">
								{linksQuery.data.map((linked) => {
									const linkedAmountDisplay = resolveAmountDisplay(linked);
									return (
										<li
											key={linked.id}
											className="flex items-start justify-between gap-2"
										>
											<span className="truncate">{linked.counter_party}</span>
											<div className="text-right shrink-0">
												<span className="text-gray-10">
													{f.amount(linkedAmountDisplay.amount, linkedAmountDisplay.currency)}
												</span>
												{linkedAmountDisplay.original && (
													<div className="text-gray-9 leading-tight">
														({f.amount(linkedAmountDisplay.original.amount, linkedAmountDisplay.original.currency)})
													</div>
												)}
											</div>
											<button
												type="button"
												className="text-gray-10 hover:text-red-11 shrink-0"
												onClick={() =>
													unlinkMutation.mutate({ aId: txId, bId: linked.id })
												}
											>
												unlink
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</div>
			</SelectedTx>
		);
}

function FilterControls({
	q,
	categoryId,
	accountId,
	currency,
	uncategorized,
	hasFilters,
	categories,
	accounts,
	currencies,
	setParams,
}: {
	q: string;
	categoryId: string;
	accountId: string;
	currency: string;
	uncategorized: boolean;
	hasFilters: boolean;
	categories: Array<{ id: string; name: string }> | undefined;
	accounts: Array<{ id: string; name: string; currency: string }> | undefined;
	currencies: string[] | undefined;
	setParams: (updates: Record<string, string | undefined>) => void;
}) {
	return (
		<div className="space-y-2">
			<Input
				size="sm"
				type="text"
				placeholder="search..."
				autoComplete="off"
				value={q}
				onChange={(e) => setParams({ q: e.currentTarget.value || undefined })}
			/>
			<div className="flex gap-2">
				<Select
					size="sm"
					className="flex-1 min-w-0"
					value={uncategorized ? "__uncat__" : categoryId}
					onChange={(e) => {
						const v = e.currentTarget.value;
						if (v === "__uncat__") {
							setParams({ cat: undefined, uncat: "1" });
						} else {
							setParams({ cat: v || undefined, uncat: undefined });
						}
					}}
				>
					<option value="">all categories</option>
					<option value="__uncat__">uncategorized</option>
					{categories?.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
				<Select
					size="sm"
					className="flex-1 min-w-0"
					value={accountId}
					onChange={(e) =>
						setParams({ acc: e.currentTarget.value || undefined })
					}
				>
					<option value="">all accounts</option>
					{accounts?.map((a) => (
						<option key={a.id} value={a.id}>
							{`${a.name} (${a.currency})`}
						</option>
					))}
				</Select>
				<Select
					size="sm"
					className="flex-1 min-w-0"
					value={currency}
					onChange={(e) =>
						setParams({ cur: e.currentTarget.value || undefined })
					}
				>
					<option value="">all currencies</option>
					{currencies?.map((currencyCode) => (
						<option key={currencyCode} value={currencyCode}>
							{currencyCode}
						</option>
					))}
				</Select>
			</div>
			{hasFilters && (
				<button
					type="button"
					className="text-xs text-gray-10 hover:text-gray-12 underline"
					onClick={() =>
						setParams({
							q: undefined,
							cat: undefined,
							acc: undefined,
							cur: undefined,
							uncat: undefined,
						})
					}
				>
					clear all
				</button>
			)}
		</div>
	);
}

function MobileFilterBar({
	showFilters,
	setShowFilters,
	hasFilters,
	q,
	categoryId,
	accountId,
	currency,
	uncategorized,
	categories,
	accounts,
	currencies,
	setParams,
}: {
	showFilters: boolean;
	setShowFilters: (v: boolean) => void;
	hasFilters: boolean;
	q: string;
	categoryId: string;
	accountId: string;
	currency: string;
	uncategorized: boolean;
	categories: Array<{ id: string; name: string }> | undefined;
	accounts: Array<{ id: string; name: string; currency: string }> | undefined;
	currencies: string[] | undefined;
	setParams: (updates: Record<string, string | undefined>) => void;
}) {
	return (
		<div className="fixed bottom-10 left-0 right-0 z-40 sm:hidden">
			<div className="mx-auto max-w-[35rem] px-3">
				{showFilters && (
					<div className="border border-b-0 border-gray-a4 bg-gray-2 px-3 py-3">
						<FilterControls
							q={q}
							categoryId={categoryId}
							accountId={accountId}
							currency={currency}
							uncategorized={uncategorized}
							hasFilters={hasFilters}
							categories={categories}
							accounts={accounts}
							currencies={currencies}
							setParams={setParams}
						/>
					</div>
				)}
				<button
					type="button"
					className={
						"w-full border border-gray-a4 bg-gray-2 px-3 py-2 text-xs text-left" +
						(hasFilters ? " text-gray-12" : " text-gray-10")
					}
					onClick={() => setShowFilters(!showFilters)}
				>
					{hasFilters ? "filters (on)" : "filters"}
				</button>
			</div>
		</div>
	);
}

function BulkEditBar({
	selectedIds,
	onClear,
}: {
	selectedIds: Set<string>;
	onClear: () => void;
}) {
	const categories = useCategoryOptionsQuery();
	const bulkSetCategory = useBulkSetCategoryMutation();
	const [categoryId, setCategoryId] = useState("");

	async function handleApply() {
		if (!categoryId) return;
		await bulkSetCategory.mutateAsync({
			txIds: [...selectedIds],
			categoryId: categoryId === "__none__" ? null : categoryId,
		});
		onClear();
	}

	return (
		<div className="fixed bottom-20 left-0 right-0 sm:bottom-0 z-30">
			<div className="mx-auto max-w-[35rem] border border-gray-a4 bg-gray-2 px-4 py-3 shadow-lg flex items-center gap-3">
				<span className="text-sm shrink-0">{selectedIds.size} selected</span>

				<Select
					size="sm"
					className="flex-1 min-w-0"
					value={categoryId}
					onChange={(e) => setCategoryId(e.currentTarget.value)}
				>
					<option value="">set category...</option>
					<option value="__none__">-- no category --</option>
					{categories.data?.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>

				<Button
					size="sm"
					onClick={handleApply}
					disabled={!categoryId || bulkSetCategory.isPending}
				>
					apply
				</Button>
				<Button size="sm" variant="ghost" onClick={onClear}>
					cancel
				</Button>
			</div>
		</div>
	);
}
