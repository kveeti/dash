import * as Ariakit from "@ariakit/react";
import { startTransition, useMemo, useState, type ReactNode } from "react";
import type { TransactionSort } from "../lib/queries/transactions";
import { IconPlus } from "./icons/plus";
import { IconChevronDown } from "./icons/chevron-down";
import { IconChevronLeft } from "./icons/chevron-left";
import { IconCross } from "./icons/cross";
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
	onRequestCustomDate?: () => void;
};

const chipClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-gray-a3 bg-gray-a2 pl-2 pr-1 text-[11px] text-gray-12 hover:bg-gray-a3 hover:border-gray-a5";

const addButtonClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-gray-a5 px-2 text-[11px] text-gray-11 hover:text-gray-12 hover:border-gray-a7 hover:bg-gray-a2";

const mobileSearchClass =
	"bg-gray-1 h-9 w-full shrink-0 border-b border-gray-a3 px-3 text-[13px] text-gray-12 outline-none placeholder:text-gray-9 dark:bg-gray-3";

const mobileItemClass =
	"flex min-h-10 w-full cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] text-gray-12 outline-none select-none data-[active-item]:bg-gray-a3 hover:bg-gray-a3";

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

type FilterView = "root" | RootChoice | "custom-date";

function queryTokens(query: string) {
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function pathMatchesQuery(query: string, labels: Array<string | undefined>) {
	const tokens = queryTokens(query);
	if (!tokens.length) return true;
	const haystack = labels.filter(Boolean).join(" ").toLowerCase();
	return tokens.every((token) => haystack.includes(token));
}

function rootChoiceMatchesQuery({
	choice,
	query,
	dateRange,
	categories,
	accounts,
	currencies,
	tags,
}: {
	choice: RootChoice;
	query: string;
	dateRange: DateRange;
	categories: CategoryOption[] | undefined;
	accounts: AccountOption[] | undefined;
	currencies: string[] | undefined;
	tags: TagOption[] | undefined;
}) {
	if (pathMatchesQuery(query, [choice])) return true;

	switch (choice) {
		case "date":
			return [
				...datePresets.map((preset) => preset.label),
				"custom range",
				dateRange ? "clear date" : undefined,
			].some((label) => pathMatchesQuery(query, ["date", label]));
		case "category":
			return [
				"uncategorized",
				...(categories ?? []).map((category) => category.name),
			].some((label) => pathMatchesQuery(query, ["category", label]));
		case "account":
			return (accounts ?? []).some((account) =>
				pathMatchesQuery(query, ["account", account.name, account.currency]),
			);
		case "tags":
			return (tags ?? []).some((tag) =>
				pathMatchesQuery(query, ["tags", tag.name]),
			);
		case "currency":
			return (currencies ?? []).some((currency) =>
				pathMatchesQuery(query, ["currency", currency]),
			);
	}
}

type MobileGlobalFilterItem = {
	key: string;
	value: string;
	label: ReactNode;
	breadcrumb?: string;
	checked?: boolean;
	multi?: boolean;
	closeOnSelect?: boolean;
	onSelect: () => void;
};

function checkedDatePreset(dateRange: DateRange, preset: DatePreset) {
	const range = preset.range();
	return dateRange?.from === range.from && dateRange?.to === range.to;
}

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
	const [mobileOpen, setMobileOpen] = useState(false);
	const [mobileView, setMobileView] = useState<FilterView>("root");

	const matches = useMemo(
		() =>
			rootChoices.filter((choice) =>
				rootChoiceMatchesQuery({
					choice: choice.id,
					query: rootQuery,
					dateRange,
					categories,
					accounts,
					currencies,
					tags,
				}),
			),
		[rootQuery, dateRange, categories, accounts, currencies, tags],
	);

	const trigger = (
		<button type="button" className={addButtonClass}>
			<IconPlus className="size-3" />
			<span>add filter</span>
		</button>
	);

	return (
		<>
			<span className="hidden sm:inline-flex">
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
			</span>

			<span className="sm:hidden">
				<button
					type="button"
					className={addButtonClass}
					onClick={() => {
						setMobileView("root");
						setMobileOpen(true);
					}}
				>
					<IconPlus className="size-3" />
					<span>add filter</span>
				</button>
			</span>

			<MobileFilterDialog
				open={mobileOpen}
				view={mobileView}
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
				setView={setMobileView}
				onOpenChange={(open) => {
					setMobileOpen(open);
					if (!open) setMobileView("root");
				}}
			/>

			<Dialog.Root open={customDateOpen} onOpenChange={setCustomDateOpen}>
				<Dialog.Content className="max-sm:hidden !w-auto !max-w-fit !p-4">
					<Dialog.Title className="text-[12px] text-gray-11 font-mono mb-3 text-center">custom date range</Dialog.Title>
					<DateRangeDialog
						value={dateRange}
						onChange={(next) => setParams({ from: next.from, to: next.to })}
						onOpenChange={setCustomDateOpen}
					/>
				</Dialog.Content>
			</Dialog.Root>
		</>
	);
}

function MobileFilterDialog({
	open,
	view,
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
	setView,
	onOpenChange,
}: TransactionFilterMenuProps & {
	open: boolean;
	view: FilterView;
	setView: (view: FilterView) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const close = () => onOpenChange(false);
	const title = getMobileFilterTitle(view);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content
				className="sm:hidden !left-3 !right-3 !top-[12dvh] !bottom-auto !w-auto !max-w-none !max-h-[76dvh] !translate-x-0 !translate-y-0 !transform-none !overflow-hidden !rounded-lg !p-0 flex flex-col"
			>
				<div className="flex h-11 shrink-0 items-center gap-1 border-b border-gray-a3 px-2">
					{view === "root" ? (
						<span className="size-8" />
					) : (
						<button
							type="button"
							className="focus flex size-8 items-center justify-center rounded-md text-gray-11 hover:bg-gray-a2 hover:text-gray-12"
							aria-label="back"
							onClick={() => setView("root")}
						>
							<IconChevronLeft />
						</button>
					)}
					<Dialog.Title className="flex-1 truncate text-center">
						{title}
					</Dialog.Title>
					<button
						type="button"
						className="focus flex size-8 items-center justify-center rounded-md text-gray-11 hover:bg-gray-a2 hover:text-gray-12"
						aria-label="close"
						onClick={close}
					>
						<IconCross className="size-3.5" />
					</button>
				</div>

				<div className="min-h-0 flex-1">
					{view === "root" && (
						<MobileRootFilterView
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
							setView={setView}
							close={close}
						/>
					)}
					{view === "date" && (
						<MobileDateFilterView
							dateRange={dateRange}
							setParams={setParams}
							setView={setView}
							close={close}
						/>
					)}
					{view === "category" && (
						<MobileCategoryFilterView
							value={categoryId}
							uncategorized={uncategorized}
							categories={categories}
							setParams={setParams}
							close={close}
						/>
					)}
					{view === "account" && (
						<MobileAccountFilterView
							value={accountId}
							accounts={accounts}
							setParams={setParams}
							close={close}
						/>
					)}
					{view === "tags" && (
						<MobileTagFilterView
							tagIds={tagIds}
							tags={tags}
							setParams={setParams}
						/>
					)}
					{view === "currency" && (
						<MobileCurrencyFilterView
							currencyIds={currencyIds}
							currencies={currencies}
							setParams={setParams}
						/>
					)}
					{view === "custom-date" && (
						<div className="combobox-list-scroll overflow-y-auto p-3">
							<DateRangeDialog
								value={dateRange}
								onChange={(next) => setParams({ from: next.from, to: next.to })}
								onOpenChange={(nextOpen) => {
									if (!nextOpen) close();
								}}
							/>
						</div>
					)}
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function getMobileFilterTitle(view: FilterView) {
	switch (view) {
		case "root":
			return "add filter";
		case "custom-date":
			return "custom date range";
		default:
			return view;
	}
}

function MobileRootFilterView({
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
	setView,
	close,
}: TransactionFilterMenuProps & {
	setView: (view: FilterView) => void;
	close: () => void;
}) {
	const [query, setQuery] = useState("");
	const filteredRootChoices = useMemo(
		() =>
			rootChoices.filter((choice) =>
				rootChoiceMatchesQuery({
					choice: choice.id,
					query,
					dateRange,
					categories,
					accounts,
					currencies,
					tags,
				}),
			),
		[query, dateRange, categories, accounts, currencies, tags],
	);
	const globalMatches = useMemo(
		() =>
			buildMobileGlobalFilterItems({
				query,
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
				setView,
			}),
		[
			query,
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
			setView,
		],
	);
	const hasSearch = query.trim().length > 0;

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="filter..."
		>
			{hasSearch ? (
				<>
					{globalMatches.map((item) => (
						<MobileActionItem key={item.key} item={item} close={close} />
					))}
					{!globalMatches.length && <MobileFilterEmpty>no filters</MobileFilterEmpty>}
				</>
			) : (
				<>
					{filteredRootChoices.map((choice) => (
						<MobileNavItem
							key={choice.id}
							value={choice.id}
							onClick={() => setView(choice.id)}
						>
							{choice.label}
						</MobileNavItem>
					))}
					{!filteredRootChoices.length && (
						<MobileFilterEmpty>no filters</MobileFilterEmpty>
					)}
				</>
			)}
		</MobileComboboxView>
	);
}

function buildMobileGlobalFilterItems({
	query,
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
	setView,
}: TransactionFilterMenuProps & {
	query: string;
	setView: (view: FilterView) => void;
}): MobileGlobalFilterItem[] {
	const items: MobileGlobalFilterItem[] = [];

	function add(item: MobileGlobalFilterItem, path: string[]) {
		if (pathMatchesQuery(query, path)) items.push(item);
	}

	for (const choice of rootChoices) {
		add(
			{
				key: `root:${choice.id}`,
				value: `root:${choice.id}`,
				label: choice.label,
				onSelect: () => setView(choice.id),
			},
			[choice.label],
		);
	}

	for (const preset of datePresets) {
		const range = preset.range();
		add(
			{
				key: `date:${preset.id}`,
				value: `date:${preset.id}`,
				label: preset.label,
				breadcrumb: "date",
				checked: checkedDatePreset(dateRange, preset),
				closeOnSelect: true,
				onSelect: () => setParams({ from: range.from, to: range.to }),
			},
			["date", preset.label],
		);
	}

	add(
		{
			key: "date:custom",
			value: "date:custom",
			label: "custom range...",
			breadcrumb: "date",
			onSelect: () => setView("custom-date"),
		},
		["date", "custom range"],
	);

	if (dateRange) {
		add(
			{
				key: "date:clear",
				value: "date:clear",
				label: "clear date",
				breadcrumb: "date",
				closeOnSelect: true,
				onSelect: () => setParams({ from: undefined, to: undefined }),
			},
			["date", "clear date"],
		);
	}

	add(
		{
			key: "category:uncategorized",
			value: "category:uncategorized",
			label: "uncategorized",
			breadcrumb: "category",
			checked: uncategorized,
			closeOnSelect: true,
			onSelect: () => setParams({ cat: undefined, uncat: "1" }),
		},
		["category", "uncategorized"],
	);

	for (const category of categories ?? []) {
		add(
			{
				key: `category:${category.id}`,
				value: `category:${category.id}`,
				label: category.name,
				breadcrumb: "category",
				checked: categoryId === category.id,
				closeOnSelect: true,
				onSelect: () => setParams({ cat: category.id, uncat: undefined }),
			},
			["category", category.name],
		);
	}

	for (const account of accounts ?? []) {
		add(
			{
				key: `account:${account.id}`,
				value: `account:${account.id}`,
				label: (
					<span className="flex w-full items-center gap-2">
						<span className="flex-1 truncate">{account.name}</span>
						<span className="shrink-0 text-[10px] text-gray-10">
							{account.currency}
						</span>
					</span>
				),
				breadcrumb: "account",
				checked: accountId === account.id,
				closeOnSelect: true,
				onSelect: () => setParams({ acc: account.id }),
			},
			["account", account.name, account.currency],
		);
	}

	for (const tag of tags ?? []) {
		add(
			{
				key: `tag:${tag.id}`,
				value: `tag:${tag.id}`,
				label: (
					<>
						<span className="text-gray-8">#</span>
						{tag.name}
					</>
				),
				breadcrumb: "tags",
				checked: tagIds.includes(tag.id),
				multi: true,
				onSelect: () => {
					const next = tagIds.includes(tag.id)
						? tagIds.filter((tid) => tid !== tag.id)
						: [...tagIds, tag.id];
					setParams({ tags: formatStringArrayParam(next) });
				},
			},
			["tags", tag.name],
		);
	}

	for (const code of currencies ?? []) {
		add(
			{
				key: `currency:${code}`,
				value: `currency:${code}`,
				label: <span className="font-mono">{code}</span>,
				breadcrumb: "currency",
				checked: currencyIds.includes(code),
				multi: true,
				onSelect: () => {
					const next = currencyIds.includes(code)
						? currencyIds.filter((currency) => currency !== code)
						: [...currencyIds, code];
					setParams({ cur: formatStringArrayParam(next) });
				},
			},
			["currency", code],
		);
	}

	return items;
}

function MobileDateFilterView({
	dateRange,
	setParams,
	setView,
	close,
}: {
	dateRange: DateRange;
	setParams: Setter;
	setView: (view: FilterView) => void;
	close: () => void;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(datePresets, query, (preset) => preset.label),
		[query],
	);

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="search dates..."
		>
			{matches.map((preset) => {
				const range = preset.range();
				return (
					<MobileFilterItem
						key={preset.id}
						value={preset.id}
						checked={checkedDatePreset(dateRange, preset)}
						onClick={() => {
							setParams({ from: range.from, to: range.to });
							close();
						}}
					>
						{preset.label}
					</MobileFilterItem>
				);
			})}
			{!query && (
				<>
					<MobileFilterSeparator />
					<MobileFilterItem
						value="__custom__"
						onClick={() => setView("custom-date")}
					>
						custom range...
					</MobileFilterItem>
					{dateRange && (
						<MobileFilterItem
							value="__clear__"
							className="text-gray-10"
							onClick={() => {
								setParams({ from: undefined, to: undefined });
								close();
							}}
						>
							clear date
						</MobileFilterItem>
					)}
				</>
			)}
			{!matches.length && query && <MobileFilterEmpty>no matches</MobileFilterEmpty>}
		</MobileComboboxView>
	);
}

function MobileCategoryFilterView({
	value,
	uncategorized,
	categories,
	setParams,
	close,
}: {
	value: string;
	uncategorized: boolean;
	categories: CategoryOption[] | undefined;
	setParams: Setter;
	close: () => void;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(categories ?? [], query, (item) => item.name),
		[categories, query],
	);

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="search categories..."
		>
			{!query && (
				<MobileFilterItem
					value="__uncat__"
					checked={uncategorized}
					onClick={() => {
						setParams({ cat: undefined, uncat: "1" });
						close();
					}}
				>
					uncategorized
				</MobileFilterItem>
			)}
			{matches.map((item) => (
				<MobileFilterItem
					key={item.id}
					value={item.id}
					checked={value === item.id}
					onClick={() => {
						setParams({ cat: item.id, uncat: undefined });
						close();
					}}
				>
					{item.name}
				</MobileFilterItem>
			))}
			{!matches.length && query && <MobileFilterEmpty>no matches</MobileFilterEmpty>}
		</MobileComboboxView>
	);
}

function MobileAccountFilterView({
	value,
	accounts,
	setParams,
	close,
}: {
	value: string;
	accounts: AccountOption[] | undefined;
	setParams: Setter;
	close: () => void;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(accounts ?? [], query, (item) => item.name),
		[accounts, query],
	);

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="search accounts..."
		>
			{matches.map((item) => (
				<MobileFilterItem
					key={item.id}
					value={item.id}
					checked={value === item.id}
					onClick={() => {
						setParams({ acc: item.id });
						close();
					}}
				>
					<span className="flex w-full items-center gap-2">
						<span className="flex-1 truncate">{item.name}</span>
						<span className="shrink-0 text-[10px] text-gray-10">
							{item.currency}
						</span>
					</span>
				</MobileFilterItem>
			))}
			{!matches.length && <MobileFilterEmpty>no matches</MobileFilterEmpty>}
		</MobileComboboxView>
	);
}

function MobileTagFilterView({
	tagIds,
	tags,
	setParams,
}: {
	tagIds: string[];
	tags: TagOption[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(tags ?? [], query, (item) => item.name),
		[tags, query],
	);

	function toggle(id: string) {
		const next = tagIds.includes(id)
			? tagIds.filter((tid) => tid !== id)
			: [...tagIds, id];
		setParams({ tags: formatStringArrayParam(next) });
	}

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="search tags..."
		>
			{matches.map((item) => (
				<MobileFilterItem
					key={item.id}
					value={item.id}
					multi
					checked={tagIds.includes(item.id)}
					onClick={() => toggle(item.id)}
				>
					<span className="text-gray-8">#</span>
					{item.name}
				</MobileFilterItem>
			))}
			{!matches.length && <MobileFilterEmpty>no matches</MobileFilterEmpty>}
		</MobileComboboxView>
	);
}

function MobileCurrencyFilterView({
	currencyIds,
	currencies,
	setParams,
}: {
	currencyIds: string[];
	currencies: string[] | undefined;
	setParams: Setter;
}) {
	const [query, setQuery] = useState("");
	const matches = useMemo(
		() => filterByQuery(currencies ?? [], query, (item) => item),
		[currencies, query],
	);

	function toggle(code: string) {
		const next = currencyIds.includes(code)
			? currencyIds.filter((currency) => currency !== code)
			: [...currencyIds, code];
		setParams({ cur: formatStringArrayParam(next) });
	}

	return (
		<MobileComboboxView
			query={query}
			onQueryChange={setQuery}
			placeholder="search currencies..."
		>
			{matches.map((code) => (
				<MobileFilterItem
					key={code}
					value={code}
					multi
					checked={currencyIds.includes(code)}
					onClick={() => toggle(code)}
				>
					<span className="font-mono">{code}</span>
				</MobileFilterItem>
			))}
			{!matches.length && <MobileFilterEmpty>no matches</MobileFilterEmpty>}
		</MobileComboboxView>
	);
}

function MobileComboboxView({
	query,
	onQueryChange,
	placeholder,
	children,
}: {
	query: string;
	onQueryChange: (query: string) => void;
	placeholder: string;
	children: ReactNode;
}) {
	return (
		<Ariakit.ComboboxProvider
			resetValueOnHide
			includesBaseElement={false}
			value={query}
			setValue={onQueryChange}
		>
			<div className="flex h-full min-h-0 flex-col">
				<Ariakit.Combobox
					autoSelect
					render={<input placeholder={placeholder} />}
					className={mobileSearchClass}
				/>
				<Ariakit.ComboboxList
					alwaysVisible
					className="combobox-list-scroll min-h-0 flex-1 overflow-y-auto p-1"
				>
					{children}
				</Ariakit.ComboboxList>
			</div>
		</Ariakit.ComboboxProvider>
	);
}

function MobileNavItem({
	value,
	children,
	onClick,
}: {
	value: string;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<Ariakit.ComboboxItem
			value={value}
			focusOnHover
			blurOnHoverEnd={false}
			setValueOnClick={false}
			hideOnClick={false}
			className={mobileItemClass}
			onClick={onClick}
		>
			<span className="flex-1 truncate text-left">{children}</span>
			<span className="text-gray-10">›</span>
		</Ariakit.ComboboxItem>
	);
}

function MobileActionItem({
	item,
	close,
}: {
	item: MobileGlobalFilterItem;
	close: () => void;
}) {
	return (
		<MobileFilterItem
			value={item.value}
			checked={item.checked}
			multi={item.multi}
			onClick={() => {
				item.onSelect();
				if (item.closeOnSelect) close();
			}}
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				{item.breadcrumb && (
					<span className="shrink-0 text-[10px] text-gray-10">
						{item.breadcrumb}
					</span>
				)}
				<span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
			</span>
		</MobileFilterItem>
	);
}

function MobileFilterItem({
	value,
	children,
	checked,
	multi,
	className,
	onClick,
}: {
	value: string;
	children: ReactNode;
	checked?: boolean;
	multi?: boolean;
	className?: string;
	onClick: () => void;
}) {
	return (
		<Ariakit.ComboboxItem
			value={value}
			focusOnHover
			blurOnHoverEnd={false}
			setValueOnClick={false}
			hideOnClick={false}
			className={`${mobileItemClass}${className ? ` ${className}` : ""}`}
			onClick={onClick}
		>
			{multi && (
				<span
					className="border-gray-a5 bg-gray-1 mr-1 flex size-4 shrink-0 items-center justify-center border dark:bg-gray-3"
					aria-hidden
				>
					{checked && <CheckIcon />}
				</span>
			)}
			<span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">
				{children}
			</span>
			{!multi && checked && (
				<span className="text-gray-11 shrink-0">
					<CheckIcon />
				</span>
			)}
		</Ariakit.ComboboxItem>
	);
}

function CheckIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 15 15"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
		>
			<path
				d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"
				fill="currentColor"
				fillRule="evenodd"
				clipRule="evenodd"
			/>
		</svg>
	);
}

function MobileFilterSeparator() {
	return <div className="my-1 border-t border-gray-a3" />;
}

function MobileFilterEmpty({ children }: { children: ReactNode }) {
	return <div className="px-2.5 py-2 text-[12px] text-gray-10">{children}</div>;
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
	const matches = useMemo(
		() => filterByQuery(categories ?? [], query, (item) => item.name),
		[categories, query],
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
	const matches = useMemo(
		() => filterByQuery(accounts ?? [], query, (item) => item.name),
		[accounts, query],
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
	const matches = useMemo(
		() => filterByQuery(tags ?? [], query, (item) => item.name),
		[tags, query],
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
	const matches = useMemo(
		() => filterByQuery(currencies ?? [], query, (item) => item),
		[currencies, query],
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

// eslint-disable-next-line react-refresh/only-export-components
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
			className="focus inline-flex h-7 items-center gap-1 rounded-md border border-gray-a3 bg-gray-a2 px-2 text-[11px] text-gray-11 hover:text-gray-12 hover:bg-gray-a3 hover:border-gray-a5"
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
