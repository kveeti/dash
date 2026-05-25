import { useSearchParams, useLocation } from "wouter";
import { useI18n } from "../../providers";
import {
	useTransactionsQuery,
	useTransactionCurrenciesQuery,
	type TransactionRow,
	type TransactionSort,
} from "../../lib/queries/transactions";
import { useCategoryOptionsQuery } from "../../lib/queries/categories";
import { useAccountsQuery } from "../../lib/queries/accounts";
import { useTagOptionsQuery } from "../../lib/queries/tags";
import type { TransactionFilters } from "../../lib/queries/query-keys";
import { Empty } from "../../components/empty";
import { Pagination, buildPaginatedHref } from "../../components/pagination";
import {
	Fragment,
	useRef,
	type MouseEvent,
	type Ref,
} from "react";
import { Button, buttonStyles } from "../../components/button";
import { useTransactionWindows } from "../../components/transaction-windows";
import { FastLink } from "../../components/link";
import {
	formatStringArrayParam,
	parseStringArrayParam,
} from "../../lib/string-array-param";
import {
	TransactionFilterUnstableCombobox,
	buildFilterChips,
	FilterChip,
	SortMenu,
} from "../../components/transaction-filter-menu";
import { useCommandPalette } from "../../components/command-palette-context";
import { useTransactionSelection } from "../../components/transaction-selection-context";

type DateRangeFilter = {
	from: string;
	to: string;
};

function formatIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return false;
	return formatIsoDate(date) === value;
}

function normalizeDateRange(from: string, to: string): DateRangeFilter | undefined {
	if (!isIsoDate(from) || !isIsoDate(to)) return undefined;
	return from <= to ? { from, to } : { from: to, to: from };
}

function buildPath(path: string, params: Record<string, string | undefined>) {
	const next = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) next.set(key, value);
	}
	const qs = next.toString();
	return qs ? `${path}?${qs}` : path;
}

function parseTransactionSort(value: string | null): TransactionSort {
	switch (value) {
		case "date_asc":
		case "amount_desc":
		case "amount_asc":
		case "amount_abs_desc":
		case "amount_abs_asc":
		case "effective_amount_desc":
		case "effective_amount_asc":
		case "effective_amount_abs_desc":
		case "effective_amount_abs_asc":
		case "counter_party_asc":
		case "counter_party_desc":
		case "category_asc":
		case "account_asc":
			return value;
		default:
			return "date_desc";
	}
}

function isDateSort(sort: TransactionSort) {
	return sort === "date_desc" || sort === "date_asc";
}

function useFilterParams() {
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();

	const left = searchParams.get("left");
	const right = searchParams.get("right");
	const q = searchParams.get("q") ?? "";
	const categoryId = searchParams.get("cat") ?? "";
	const accountId = searchParams.get("acc") ?? "";
	const currencyIds = parseStringArrayParam(searchParams.get("cur"));
	const tagIds = parseStringArrayParam(searchParams.get("tags"));
	const sort = parseTransactionSort(searchParams.get("sort"));
	const uncategorized = searchParams.get("uncat") === "1";
	const dateRange = normalizeDateRange(
		searchParams.get("from") ?? "",
		searchParams.get("to") ?? "",
	);

	const filters: TransactionFilters = {};
	if (categoryId) filters.category_id = categoryId;
	if (accountId) filters.account_id = accountId;
	if (currencyIds.length) filters.currencies = currencyIds;
	if (tagIds.length) filters.tag_ids = tagIds;
	if (uncategorized) filters.uncategorized = true;
	if (dateRange) {
		filters.date_from = dateRange.from;
		filters.date_to = dateRange.to;
	}

	const hasFilters = !!(
		q ||
		categoryId ||
		accountId ||
		currencyIds.length ||
		tagIds.length ||
		sort !== "date_desc" ||
		uncategorized ||
		dateRange
	);

	function setParams(updates: Record<string, string | undefined>) {
		const params = new URLSearchParams();
		const current: Record<string, string> = {
			...(q && { q }),
			...(categoryId && { cat: categoryId }),
			...(accountId && { acc: accountId }),
			...(currencyIds.length && { cur: formatStringArrayParam(currencyIds) }),
			...(tagIds.length && { tags: formatStringArrayParam(tagIds) }),
			...(sort !== "date_desc" && { sort }),
			...(uncategorized && { uncat: "1" }),
			...(dateRange && { from: dateRange.from, to: dateRange.to }),
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
		cur: formatStringArrayParam(currencyIds),
		tags: formatStringArrayParam(tagIds),
		sort: sort === "date_desc" ? undefined : sort,
		uncat: uncategorized ? "1" : undefined,
		from: dateRange?.from,
		to: dateRange?.to,
	};

	return {
		left,
		right,
		q,
		categoryId,
		accountId,
		currencyIds,
		tagIds,
		sort,
		uncategorized,
		dateRange,
		filters,
		hasFilters,
		setParams,
		filterSearchParams,
	};
}

export function TransactionsPage() {
	const {
		left,
		right,
		q,
		categoryId,
		accountId,
		currencyIds,
		tagIds,
		sort,
		uncategorized,
		dateRange,
		filters,
		hasFilters,
		setParams,
		filterSearchParams,
	} = useFilterParams();

	const transactionsQuery = useTransactionsQuery({
		cursor: { left, right },
		sort,
		search: q || undefined,
		filters: Object.keys(filters).length > 0 ? filters : undefined,
	});

	const { f } = useI18n();

	const categories = useCategoryOptionsQuery();
	const accounts = useAccountsQuery();
	const currencies = useTransactionCurrenciesQuery();
	const tags = useTagOptionsQuery();

	const selection = useTransactionSelection();
	const { openTransaction } = useTransactionWindows();
	const scrolledForCursor = useRef<string | null>(null);
	const dateSorted = isDateSort(sort);
	const hideAccount = !!accountId || accounts.data?.length === 1;
	const hideCategory = !!categoryId;
	const statsHref = buildPath("/stats", {
		tab: "stats-2",
		...(dateRange ? { period: "custom", from: dateRange.from, to: dateRange.to } : {}),
		...Object.fromEntries(
			Object.entries(filterSearchParams).filter(([key]) => key !== "sort"),
		),
	});

	let currentDay: string | null = null;

	const chips = buildFilterChips({
		q,
		categoryId,
		accountId,
		currencyIds,
		tagIds,
		uncategorized,
		dateRange,
		categories: categories.data,
		accounts: accounts.data,
		tags: tags.data,
		setParams,
	});

	return (
		<>
			<div className="w-full max-w-[720px] mx-auto px-4 sm:px-6 pt-2 pb-32">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-[15px] font-medium tracking-[-0.005em]">Transactions</h1>
						<p className="text-[11px] text-gray-10 mt-0.5">
							{hasFilters ? "Filtered view" : "All transactions"}
						</p>
					</div>
					<div className="hidden sm:flex items-center gap-1.5">
						<FastLink
							href={statsHref}
							className={buttonStyles({ variant: "ghost", size: "sm" })}
						>
							Stats
						</FastLink>
					</div>
				</div>

				<div className="hidden sm:flex mt-3 flex-wrap items-center gap-1.5">
					<TransactionFilterUnstableCombobox
						categoryId={categoryId}
						accountId={accountId}
						currencyIds={currencyIds}
						tagIds={tagIds}
						uncategorized={uncategorized}
						dateRange={dateRange}
						categories={categories.data}
						accounts={accounts.data}
						currencies={currencies.data}
						tags={tags.data}
						setParams={setParams}
					/>
					{chips.map((chip) => (
						<FilterChip key={chip.key} chip={chip} />
					))}
					<div className="ml-auto">
						<SortMenu sort={sort} setParams={setParams} />
					</div>
				</div>

				<ul className="mt-4">
					{transactionsQuery.data?.transactions.map((tx, i) => {
						const day = f.weekdayShortDate.format(tx.date);
						const dayChanged = dateSorted && day !== currentDay;
						currentDay = day;

						const isSelected = selection.selectedIds.has(tx.id);

						return (
							<Fragment key={tx.id}>
								{dayChanged && (
									<div className="sticky top-12 z-10 bg-gray-1/95 backdrop-blur supports-[backdrop-filter]:bg-gray-1/80 text-[10px] uppercase tracking-[0.06em] font-medium text-gray-10 py-1.5 scroll-mt-12 border-b border-gray-a3">
										{currentDay}
									</div>
								)}

								<TxRow
									tx={tx}
									selected={isSelected}
									selecting={selection.isSelecting}
									onSelect={() => selection.toggle(tx.id)}
									onClick={(event) => {
										const rect = event.currentTarget.getBoundingClientRect();
										openTransaction(tx.id, {
											top: rect.top,
											right: rect.right,
										});
									}}
									showInlineDate={!dateSorted}
									hideAccount={!!hideAccount}
									hideCategory={hideCategory}
									liRef={(elem) => {
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
					(selection.isSelecting ? " bottom-32 sm:bottom-12" : " bottom-16 sm:bottom-0")
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
				q={q}
				categoryId={categoryId}
				accountId={accountId}
				currencyIds={currencyIds}
				tagIds={tagIds}
				uncategorized={uncategorized}
				dateRange={dateRange}
				categories={categories.data}
				accounts={accounts.data}
				currencies={currencies.data}
				tags={tags.data}
				setParams={setParams}
			/>

			{selection.isSelecting && (
				<BulkEditBar
					selectedIds={selection.selectedIds}
					onClear={selection.clear}
				/>
			)}

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

type FlowSymbol = { symbol: string; label: string };

function resolveFlowSymbol(tx: TransactionRow): FlowSymbol | null {
	if (!tx.flow_count) return null;

	const pickSymbol = (): FlowSymbol => {
		if (tx.has_exchange) return { symbol: "⇄", label: "exchange" };
		if (tx.has_transfer) return { symbol: "→", label: "transfer" };
		if (tx.has_refund) return { symbol: "↩", label: "refund" };
		if (tx.has_allocation) return { symbol: "÷", label: "allocation" };
		return { symbol: "·", label: "linked" };
	};

	const base = pickSymbol();
	if (tx.flow_count === 1) return base;
	return {
		symbol: `${base.symbol}${tx.flow_count}`,
		label: `${tx.flow_count} links`,
	};
}

type AmountDisplay = {
	primary: { amount: number; currency: string } | null;
	isIncome: boolean;
	strikePrimary: boolean;
	struckGross: { amount: number; currency: string } | null;
	originalHint: { amount: number; currency: string } | null;
};

function resolveAmountDisplay(tx: TransactionRow): AmountDisplay {
	const wasConverted =
		tx.converted_amount != null && tx.currency !== tx.converted_currency;
	const wasModified =
		tx.effective_original_amount_minor !== tx.original_amount_minor;

	const displayCurrency = wasConverted ? tx.converted_currency : tx.currency;
	const displayGross = wasConverted
		? (tx.converted_amount as number)
		: tx.amount;

	let displayEffective: number;
	if (wasConverted && tx.amount !== 0) {
		const ratio = tx.effective_amount / tx.amount;
		displayEffective = (tx.converted_amount as number) * ratio;
	} else {
		displayEffective = tx.effective_amount;
	}

	const fullyNullified = wasModified && tx.effective_amount === 0;
	const isPositiveExchange = !!tx.has_exchange && tx.amount > 0;

	// For positive exchange (inflow side), the converted amount is misleading —
	// it's just the same amount expressed in the reporting currency. Show the
	// original currency amount as primary (struck) so the user sees what was
	// actually received in the exchange.
	if (isPositiveExchange) {
		return {
			primary: { amount: tx.amount, currency: tx.currency },
			isIncome: false,
			strikePrimary: true,
			struckGross: null,
			originalHint: null,
		};
	}

	const referenceForSign = fullyNullified ? displayGross : displayEffective;

	return {
		primary: fullyNullified
			? null
			: { amount: displayEffective, currency: displayCurrency },
		isIncome: referenceForSign > 0,
		strikePrimary: false,
		struckGross: wasModified
			? { amount: displayGross, currency: displayCurrency }
			: null,
		originalHint: wasConverted
			? { amount: tx.amount, currency: tx.currency }
			: null,
	};
}

const VISIBLE_TAG_LIMIT = 2;

function TxRow({
	tx,
	selected,
	selecting,
	showInlineDate,
	hideAccount,
	hideCategory,
	onSelect,
	onClick,
	liRef,
}: {
	tx: TransactionRow;
	selected: boolean;
	selecting: boolean;
	showInlineDate: boolean;
	hideAccount: boolean;
	hideCategory: boolean;
	onSelect: () => void;
	onClick: (event: MouseEvent<HTMLDivElement>) => void;
	liRef: Ref<HTMLLIElement>;
}) {
	const { f } = useI18n();
	const amountDisplay = resolveAmountDisplay(tx);
	const flowSymbol = resolveFlowSymbol(tx);
	const visibleTags = tx.tags.slice(0, VISIBLE_TAG_LIMIT);
	const overflowTagCount = tx.tags.length - visibleTags.length;

	const longPress = useLongPress(() => {
		onSelect();
	});

	return (
		<li ref={liRef} className="scroll-mt-17 border-b border-gray-a3 last:border-b-0">
			<div
				className={
					"flex items-start justify-between gap-3 hover:bg-gray-a2 px-2 py-2.5 select-none transition-colors" +
					(selected ? " bg-gray-a3" : "")
				}
				onClick={(event) => {
					if (longPress.didFire.current) return;
					if (selecting) {
						onSelect();
					} else {
						onClick(event);
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					onSelect();
				}}
				onTouchStart={longPress.onTouchStart}
				onTouchEnd={longPress.onTouchEnd}
				onTouchMove={longPress.onTouchMove}
			>
				{selecting && (
					<input
						type="checkbox"
						checked={selected}
						onChange={onSelect}
						onClick={(e) => e.stopPropagation()}
						className="shrink-0"
					/>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						{showInlineDate && (
							<span className="shrink-0 text-xs text-gray-10 tabular-nums">
								{f.shortDate.format(tx.date)}
							</span>
						)}
						<span className="truncate font-medium">{tx.counter_party}</span>
					</div>
					<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
						{!hideCategory && tx.category_name && (
							<span className="truncate text-gray-12">
								{tx.category_name}
							</span>
						)}
						{!hideCategory && tx.category_name && !hideAccount && (
							<span className="shrink-0 text-gray-8">·</span>
						)}
						{!hideAccount && (
							<span
								className="shrink-0 font-mono text-gray-10 tabular-nums"
								title={tx.account_name}
							>
								{tx.account_code}
							</span>
						)}
						{visibleTags.length > 0 && (
							<div className="ml-1 flex min-w-0 items-center gap-1">
								{visibleTags.map((tag) => (
									<span key={tag.id} className="shrink-0 text-gray-11">
										<span className="text-gray-8">#</span>
										{tag.name}
									</span>
								))}
								{overflowTagCount > 0 && (
									<span className="shrink-0 text-gray-10">
										+{overflowTagCount}
									</span>
								)}
							</div>
						)}
					</div>
				</div>
				<div className="shrink-0">
					<div className="flex items-baseline justify-end gap-1.5">
						{flowSymbol && (
							<span
								className="text-xs text-gray-10"
								title={flowSymbol.label}
							>
								{flowSymbol.symbol}
							</span>
						)}
						{amountDisplay.struckGross && (
							<span className="text-sm text-gray-10 line-through">
								{f.amount(
									amountDisplay.struckGross.amount,
									amountDisplay.struckGross.currency,
								)}
							</span>
						)}
						{amountDisplay.originalHint && (
							<span
								className={
									"text-[11px] text-gray-10" +
									(amountDisplay.struckGross ? " line-through" : "")
								}
							>
								(
								{f.amount(
									amountDisplay.originalHint.amount,
									amountDisplay.originalHint.currency,
								)}
								)
							</span>
						)}
						{amountDisplay.primary && (
							<span
								className={
									"text-sm" +
									(amountDisplay.strikePrimary
										? " text-gray-10 line-through"
										: amountDisplay.isIncome
											? " text-green-11"
											: "")
								}
							>
								{f.amount(
									amountDisplay.primary.amount,
									amountDisplay.primary.currency,
								)}
							</span>
						)}
					</div>
				</div>
			</div>
		</li>
	);
}

function MobileFilterBar({
	q,
	categoryId,
	accountId,
	currencyIds,
	tagIds,
	uncategorized,
	dateRange,
	categories,
	accounts,
	currencies,
	tags,
	setParams,
}: {
	q: string;
	categoryId: string;
	accountId: string;
	currencyIds: string[];
	tagIds: string[];
	uncategorized: boolean;
	dateRange: DateRangeFilter | undefined;
	categories: Array<{ id: string; name: string }> | undefined;
	accounts: Array<{ id: string; name: string; currency: string }> | undefined;
	currencies: string[] | undefined;
	tags: Array<{ id: string; name: string }> | undefined;
	setParams: (updates: Record<string, string | undefined>) => void;
}) {
	const chips = buildFilterChips({
		q,
		categoryId,
		accountId,
		currencyIds,
		tagIds,
		uncategorized,
		dateRange,
		categories,
		accounts,
		tags,
		setParams,
	});

	return (
		<div className="fixed bottom-10 left-0 right-0 z-40 sm:hidden">
			<div className="mx-auto max-w-[35rem] px-3">
				<div className="flex flex-wrap items-center gap-1.5 border border-gray-a4 bg-gray-2 px-3 py-2">
					<TransactionFilterUnstableCombobox
						categoryId={categoryId}
						accountId={accountId}
						currencyIds={currencyIds}
						tagIds={tagIds}
						uncategorized={uncategorized}
						dateRange={dateRange}
						categories={categories}
						accounts={accounts}
						currencies={currencies}
						tags={tags}
						setParams={setParams}
					/>
					{chips.map((chip) => (
						<FilterChip key={chip.key} chip={chip} />
					))}
				</div>
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
	const { openCommandPalette } = useCommandPalette();

	return (
		<div className="fixed bottom-4 left-0 right-0 z-30 px-4">
			<div className="mx-auto flex max-w-[35rem] items-center gap-2 rounded-lg border border-gray-a4 bg-gray-1 px-3 py-2.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.2),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6),0_4px_12px_-4px_rgba(0,0,0,0.4)]">
				<span className="min-w-0 flex-1 text-[12px] text-gray-11 num">
					{selectedIds.size} selected
				</span>
				<Button size="sm" onClick={openCommandPalette}>
					actions
				</Button>
				<Button size="sm" variant="ghost" onClick={onClear}>
					cancel
				</Button>
			</div>
		</div>
	);
}
