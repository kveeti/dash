import { startTransition, useMemo, useState } from "react";
import type { TransactionSort } from "../lib/queries/transactions";
import { IconPlus } from "./icons/plus";
import { IconChevronDown } from "./icons/chevron-down";
import { formatStringArrayParam } from "../lib/string-array-param";
import {
	NestedMenu,
	NestedMenuItem,
	NestedMenuEmpty,
	NestedMenuSeparator,
} from "./nested-menu";
import { DateRangeDialog } from "./date-picker";
import * as Dialog from "./dialog";

type DateRange = { from: string; to: string } | undefined;

type CategoryOption = { id: string; name: string };
type AccountOption = { id: string; name: string; currency: string };
type TagOption = { id: string; name: string };

type Setter = (updates: Record<string, string | undefined>) => void;

export type TransactionFilterMenuProps = {
	categoryId: string;
	accountId: string;
	currencyIds: string[];
	tagIds: string[];
	uncategorized: boolean;
	dateRange: DateRange;
	categories: CategoryOption[] | undefined;
	accounts: AccountOption[] | undefined;
	currencies: string[] | undefined;
	tags: TagOption[] | undefined;
	setParams: Setter;
};

const chipClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-gray-a4 bg-gray-2 pl-2 pr-1 text-[11px] text-gray-12 hover:bg-gray-a3";

const addButtonClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-gray-a5 px-2 text-[11px] text-gray-11 hover:text-gray-12 hover:border-gray-a7 hover:bg-gray-a2";

function filterByQuery<T>(items: T[], query: string, label: (item: T) => string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter((item) => label(item).toLowerCase().includes(q));
}

function formatIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

type DatePreset = { id: string; label: string; range: () => { from: string; to: string } };

const datePresets: DatePreset[] = [
	{
		id: "today",
		label: "today",
		range: () => {
			const d = formatIsoDate(new Date());
			return { from: d, to: d };
		},
	},
	{
		id: "last7",
		label: "last 7 days",
		range: () => {
			const to = new Date();
			const from = new Date(to);
			from.setUTCDate(from.getUTCDate() - 6);
			return { from: formatIsoDate(from), to: formatIsoDate(to) };
		},
	},
	{
		id: "last30",
		label: "last 30 days",
		range: () => {
			const to = new Date();
			const from = new Date(to);
			from.setUTCDate(from.getUTCDate() - 29);
			return { from: formatIsoDate(from), to: formatIsoDate(to) };
		},
	},
	{
		id: "this-month",
		label: "this month",
		range: () => {
			const now = new Date();
			return {
				from: formatIsoDate(startOfMonth(now)),
				to: formatIsoDate(endOfMonth(now)),
			};
		},
	},
	{
		id: "last-month",
		label: "last month",
		range: () => {
			const now = new Date();
			const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
			return {
				from: formatIsoDate(startOfMonth(lastMonth)),
				to: formatIsoDate(endOfMonth(lastMonth)),
			};
		},
	},
	{
		id: "ytd",
		label: "year to date",
		range: () => {
			const now = new Date();
			return {
				from: `${now.getUTCFullYear()}-01-01`,
				to: formatIsoDate(now),
			};
		},
	},
	{
		id: "this-year",
		label: "this year",
		range: () => {
			const now = new Date();
			return {
				from: `${now.getUTCFullYear()}-01-01`,
				to: `${now.getUTCFullYear()}-12-31`,
			};
		},
	},
];

type RootChoice =
	| "date"
	| "category"
	| "account"
	| "tags"
	| "currency";

const rootChoices: { id: RootChoice; label: string }[] = [
	{ id: "date", label: "date" },
	{ id: "category", label: "category" },
	{ id: "account", label: "account" },
	{ id: "tags", label: "tags" },
	{ id: "currency", label: "currency" },
];

export function TransactionFilterMenu({
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
}: TransactionFilterMenuProps) {
	const [rootQuery, setRootQuery] = useState("");
	const [customDateOpen, setCustomDateOpen] = useState(false);

	const matches = useMemo(
		() => filterByQuery(rootChoices, rootQuery, (c) => c.label),
		[rootQuery],
	);

	const trigger = (
		<button type="button" className={addButtonClass}>
			<IconPlus className="size-3" />
			<span>add filter</span>
		</button>
	);

	return (
		<>
			<NestedMenu
				trigger={trigger}
				combobox={<input placeholder="filter…" />}
				onSearch={(value) => startTransition(() => setRootQuery(value))}
			>
				{matches.length === 0 && <NestedMenuEmpty>no filters</NestedMenuEmpty>}
				{matches.map((choice) => {
					switch (choice.id) {
						case "date":
							return (
								<DateSubmenu
									key="date"
									dateRange={dateRange}
									setParams={setParams}
									onRequestCustom={() => setCustomDateOpen(true)}
								/>
							);
						case "category":
							return (
								<CategorySubmenu
									key="category"
									value={categoryId}
									uncategorized={uncategorized}
									categories={categories}
									setParams={setParams}
								/>
							);
						case "account":
							return (
								<AccountSubmenu
									key="account"
									value={accountId}
									accounts={accounts}
									setParams={setParams}
								/>
							);
						case "tags":
							return (
								<TagSubmenu
									key="tags"
									tagIds={tagIds}
									tags={tags}
									setParams={setParams}
								/>
							);
						case "currency":
							return (
								<CurrencySubmenu
									key="currency"
									currencyIds={currencyIds}
									currencies={currencies}
									setParams={setParams}
								/>
							);
					}
				})}
			</NestedMenu>

			<Dialog.Root open={customDateOpen} onOpenChange={setCustomDateOpen}>
				<Dialog.Content className="!max-w-[24rem]">
					<Dialog.Title>custom date range</Dialog.Title>
					<div className="mt-3">
						<DateRangeDialog
							value={dateRange}
							onChange={(next) => setParams({ from: next.from, to: next.to })}
							onOpenChange={setCustomDateOpen}
						/>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</>
	);
}

function DateSubmenu({
	dateRange,
	setParams,
	onRequestCustom,
}: {
	dateRange: DateRange;
	setParams: Setter;
	onRequestCustom: () => void;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(datePresets, query, (p) => p.label),
		[query],
	);

	return (
		<NestedMenu
			label="date"
			combobox={<input placeholder="search dates…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{matches.map((preset) => {
				const range = preset.range();
				const checked =
					dateRange?.from === range.from && dateRange?.to === range.to;
				return (
					<NestedMenuItem
						key={preset.id}
						value={preset.id}
						checked={checked}
						closeAllOnClick
						onClick={() => setParams({ from: range.from, to: range.to })}
					>
						{preset.label}
					</NestedMenuItem>
				);
			})}
			{!query && (
				<>
					<NestedMenuSeparator />
					<NestedMenuItem
						value="__custom__"
						closeAllOnClick
						onClick={onRequestCustom}
					>
						custom range…
					</NestedMenuItem>
					{dateRange && (
						<NestedMenuItem
							value="__clear__"
							closeAllOnClick
							className="text-gray-10"
							onClick={() => setParams({ from: undefined, to: undefined })}
						>
							clear date
						</NestedMenuItem>
					)}
				</>
			)}
			{!matches.length && query && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}

function CategorySubmenu({
	value,
	uncategorized,
	categories,
	setParams,
}: {
	value: string;
	uncategorized: boolean;
	categories: CategoryOption[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const items = categories ?? [];
	const matches = useMemo(
		() => filterByQuery(items, query, (item) => item.name),
		[items, query],
	);

	return (
		<NestedMenu
			label="category"
			combobox={<input placeholder="search categories…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{!query && (
				<NestedMenuItem
					value="__uncat__"
					checked={uncategorized}
					closeAllOnClick
					onClick={() => setParams({ cat: undefined, uncat: "1" })}
				>
					uncategorized
				</NestedMenuItem>
			)}
			{matches.map((item) => (
				<NestedMenuItem
					key={item.id}
					value={item.id}
					checked={value === item.id}
					closeAllOnClick
					onClick={() => setParams({ cat: item.id, uncat: undefined })}
				>
					{item.name}
				</NestedMenuItem>
			))}
			{!matches.length && query && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}

function AccountSubmenu({
	value,
	accounts,
	setParams,
}: {
	value: string;
	accounts: AccountOption[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const items = accounts ?? [];
	const matches = useMemo(
		() => filterByQuery(items, query, (item) => item.name),
		[items, query],
	);

	return (
		<NestedMenu
			label="account"
			combobox={<input placeholder="search accounts…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{matches.map((item) => (
				<NestedMenuItem
					key={item.id}
					value={item.id}
					checked={value === item.id}
					closeAllOnClick
					onClick={() => setParams({ acc: item.id })}
				>
					<span className="flex w-full items-center gap-2">
						<span className="flex-1 truncate">{item.name}</span>
						<span className="shrink-0 text-[10px] text-gray-10">
							{item.currency}
						</span>
					</span>
				</NestedMenuItem>
			))}
			{!matches.length && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}

function TagSubmenu({
	tagIds,
	tags,
	setParams,
}: {
	tagIds: string[];
	tags: TagOption[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const items = tags ?? [];
	const matches = useMemo(
		() => filterByQuery(items, query, (item) => item.name),
		[items, query],
	);

	function toggle(id: string) {
		const next = tagIds.includes(id)
			? tagIds.filter((tid) => tid !== id)
			: [...tagIds, id];
		setParams({ tags: formatStringArrayParam(next) });
	}

	return (
		<NestedMenu
			label={
				<>
					tags
					{tagIds.length > 0 && (
						<span className="ml-1 text-gray-10">({tagIds.length})</span>
					)}
				</>
			}
			combobox={<input placeholder="search tags…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{matches.map((item) => (
				<NestedMenuItem
					key={item.id}
					value={item.id}
					multi
					checked={tagIds.includes(item.id)}
					onClick={() => toggle(item.id)}
				>
					<span className="text-gray-8">#</span>
					{item.name}
				</NestedMenuItem>
			))}
			{!matches.length && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}

function CurrencySubmenu({
	currencyIds,
	currencies,
	setParams,
}: {
	currencyIds: string[];
	currencies: string[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const items = currencies ?? [];
	const matches = useMemo(
		() => filterByQuery(items, query, (item) => item),
		[items, query],
	);

	function toggle(code: string) {
		const next = currencyIds.includes(code)
			? currencyIds.filter((c) => c !== code)
			: [...currencyIds, code];
		setParams({ cur: formatStringArrayParam(next) });
	}

	return (
		<NestedMenu
			label={
				<>
					currency
					{currencyIds.length > 0 && (
						<span className="ml-1 text-gray-10">({currencyIds.length})</span>
					)}
				</>
			}
			combobox={<input placeholder="search currencies…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{matches.map((code) => (
				<NestedMenuItem
					key={code}
					value={code}
					multi
					checked={currencyIds.includes(code)}
					onClick={() => toggle(code)}
				>
					<span className="font-mono">{code}</span>
				</NestedMenuItem>
			))}
			{!matches.length && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}

export type ChipDescriptor = {
	key: string;
	label: string;
	value: string;
	onClear: () => void;
};

export function buildFilterChips({
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
}: {
	q: string;
	categoryId: string;
	accountId: string;
	currencyIds: string[];
	tagIds: string[];
	uncategorized: boolean;
	dateRange: DateRange;
	categories: CategoryOption[] | undefined;
	accounts: AccountOption[] | undefined;
	tags: TagOption[] | undefined;
	setParams: Setter;
}): ChipDescriptor[] {
	const chips: ChipDescriptor[] = [];

	if (q) {
		chips.push({
			key: "q",
			label: "search",
			value: `"${q}"`,
			onClear: () => setParams({ q: undefined }),
		});
	}

	if (dateRange) {
		chips.push({
			key: "date",
			label: "date",
			value:
				dateRange.from === dateRange.to
					? dateRange.from
					: `${dateRange.from} → ${dateRange.to}`,
			onClear: () => setParams({ from: undefined, to: undefined }),
		});
	}

	if (uncategorized) {
		chips.push({
			key: "uncat",
			label: "category",
			value: "uncategorized",
			onClear: () => setParams({ uncat: undefined }),
		});
	} else if (categoryId) {
		const name =
			categories?.find((c) => c.id === categoryId)?.name ?? categoryId;
		chips.push({
			key: "cat",
			label: "category",
			value: name,
			onClear: () => setParams({ cat: undefined }),
		});
	}

	if (accountId) {
		const name =
			accounts?.find((a) => a.id === accountId)?.name ?? accountId;
		chips.push({
			key: "acc",
			label: "account",
			value: name,
			onClear: () => setParams({ acc: undefined }),
		});
	}

	if (tagIds.length) {
		const names = tagIds.map(
			(id) => tags?.find((t) => t.id === id)?.name ?? id,
		);
		chips.push({
			key: "tags",
			label: "tags",
			value: names.map((n) => `#${n}`).join(", "),
			onClear: () => setParams({ tags: undefined }),
		});
	}

	if (currencyIds.length) {
		chips.push({
			key: "cur",
			label: "currency",
			value: currencyIds.join(", "),
			onClear: () => setParams({ cur: undefined }),
		});
	}

	return chips;
}

export function FilterChip({ chip }: { chip: ChipDescriptor }) {
	return (
		<span className={chipClass}>
			<span className="text-gray-10">{chip.label}:</span>
			<span className="truncate max-w-[12rem]">{chip.value}</span>
			<button
				type="button"
				aria-label={`remove ${chip.label} filter`}
				className="focus ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-gray-10 hover:bg-gray-a3 hover:text-gray-12"
				onClick={chip.onClear}
			>
				×
			</button>
		</span>
	);
}

const sortOptions: { value: TransactionSort; label: string }[] = [
	{ value: "date_desc", label: "newest first" },
	{ value: "date_asc", label: "oldest first" },
	{ value: "effective_amount_abs_desc", label: "largest effective amount" },
	{ value: "effective_amount_abs_asc", label: "smallest effective amount" },
	{ value: "effective_amount_desc", label: "effective income → expense" },
	{ value: "effective_amount_asc", label: "effective expense → income" },
	{ value: "amount_abs_desc", label: "largest amount" },
	{ value: "amount_abs_asc", label: "smallest amount" },
	{ value: "amount_desc", label: "income → expense" },
	{ value: "amount_asc", label: "expense → income" },
	{ value: "counter_party_asc", label: "counterparty A–Z" },
	{ value: "counter_party_desc", label: "counterparty Z–A" },
	{ value: "category_asc", label: "category A–Z" },
	{ value: "account_asc", label: "account A–Z" },
];

export function SortMenu({
	sort,
	setParams,
}: {
	sort: TransactionSort;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(sortOptions, query, (o) => o.label),
		[query],
	);
	const current = sortOptions.find((o) => o.value === sort) ?? sortOptions[0];

	const trigger = (
		<button
			type="button"
			className="focus inline-flex h-7 items-center gap-1 rounded-md border border-gray-a4 bg-gray-2 px-2 text-[11px] text-gray-11 hover:text-gray-12 hover:bg-gray-a3"
		>
			<span className="text-gray-10">sort:</span>
			<span>{current.label}</span>
			<IconChevronDown className="size-3 text-gray-10" />
		</button>
	);

	return (
		<NestedMenu
			trigger={trigger}
			combobox={<input placeholder="search sort…" />}
			onSearch={(value) => startTransition(() => setQuery(value))}
		>
			{matches.map((option) => (
				<NestedMenuItem
					key={option.value}
					value={option.value}
					checked={sort === option.value}
					closeAllOnClick
					onClick={() =>
						setParams({
							sort:
								option.value === "date_desc" ? undefined : option.value,
						})
					}
				>
					{option.label}
				</NestedMenuItem>
			))}
			{!matches.length && <NestedMenuEmpty>no matches</NestedMenuEmpty>}
		</NestedMenu>
	);
}
