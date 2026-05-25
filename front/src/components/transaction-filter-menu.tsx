import {
	startTransition,
	useCallback,
	useMemo,
	useState,
} from "react";
import type { TransactionSort } from "../lib/queries/transactions";
import { useCreateTagMutation } from "../lib/queries/tags";
import { IconPlus } from "./icons/plus";
import { IconChevronDown } from "./icons/chevron-down";
import { formatStringArrayParam } from "../lib/string-array-param";
import {
	NestedMenu,
	NestedMenuItem,
	NestedMenuEmpty,
} from "./nested-menu";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";
import { DateRangeDialog } from "./date-picker";
import * as Dialog from "./dialog";

type DateRange = { from: string; to: string } | undefined;

type CategoryOption = { id: string; name: string };
type AccountOption = { id: string; name: string; currency: string };
type TagOption = { id: string; name: string };

type Setter = (updates: Record<string, string | undefined>) => void;

export type TransactionFilterProps = {
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

export type FilterUnstableComboboxProps = TransactionFilterProps & {
	includeDate?: boolean;
	triggerLabel?: string;
};

const chipClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-gray-a3 bg-gray-a2 pl-2 pr-1 text-[11px] text-gray-12 hover:bg-gray-a3 hover:border-gray-a5";

const addButtonClass =
	"focus inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-gray-a5 px-2 text-[11px] text-gray-11 hover:text-gray-12 hover:border-gray-a7 hover:bg-gray-a2";

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

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

function checkedDatePreset(dateRange: DateRange, preset: DatePreset) {
	const range = preset.range();
	return dateRange?.from === range.from && dateRange?.to === range.to;
}

export function TransactionFilterUnstableCombobox({
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
	includeDate = true,
	triggerLabel = "add filter",
}: FilterUnstableComboboxProps) {
	const [customDateOpen, setCustomDateOpen] = useState(false);
	const createTag = useCreateTagMutation();
	const handleCreateTag = useCallback(
		async (rawName: string) => {
			if (createTag.isPending) return;

			const name = rawName.trim().replace(/\s+/g, " ");
			if (!name) return;

			const existing = tags?.find(
				(tag) => tag.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
			);
			const tagId = existing?.id ?? (await createTag.mutateAsync(name));
			const next = tagIds.includes(tagId) ? tagIds : [...tagIds, tagId];
			setParams({ tags: formatStringArrayParam(next) });
		},
		[createTag, setParams, tagIds, tags],
	);
	const config = useMemo<UnstableComboboxConfig>(
		() =>
			buildUnstableFilterConfig({
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
				onRequestCustomDate: () => setCustomDateOpen(true),
				onCreateTag: handleCreateTag,
				includeDate,
			}),
		[
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
			handleCreateTag,
			includeDate,
		],
	);

	return (
		<>
			<UnstableCombobox
				title="add filter"
				placeholder="Add filter..."
				empty="no filters"
				config={config}
				trigger={({ open }) => (
					<button
						type="button"
						className={cx(
							addButtonClass,
							open && "border-gray-a7 bg-gray-a3 text-gray-12",
						)}
					>
						<IconPlus className="size-3" />
						<span>{triggerLabel}</span>
					</button>
				)}
			/>

			{includeDate && (
				<Dialog.Root open={customDateOpen} onOpenChange={setCustomDateOpen}>
					<Dialog.Content className="!w-auto !max-w-fit !p-4">
						<Dialog.Title className="text-[12px] text-gray-11 font-mono mb-3 text-center">
							custom date range
						</Dialog.Title>
						<DateRangeDialog
							value={dateRange}
							onChange={(next) => setParams({ from: next.from, to: next.to })}
							onOpenChange={setCustomDateOpen}
						/>
					</Dialog.Content>
				</Dialog.Root>
			)}
		</>
	);
}

function buildUnstableFilterConfig({
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
	onCreateTag,
	onRequestCustomDate,
	includeDate,
}: TransactionFilterProps & {
	onCreateTag: (name: string) => void | Promise<void>;
	onRequestCustomDate: () => void;
	includeDate: boolean;
}): UnstableComboboxConfig {
	const dateItems: UnstableComboboxItem[] = [
		...datePresets.map<UnstableComboboxItem>((preset) => {
			const range = preset.range();
			return {
				id: `date:${preset.id}`,
				label: preset.label,
				checked: checkedDatePreset(dateRange, preset),
				onSelect: () => setParams({ from: range.from, to: range.to }),
			};
		}),
		{
			id: "date:custom",
			label: "custom range...",
			keywords: ["date range"],
			onSelect: ({ close }) => {
				close();
				onRequestCustomDate();
			},
		},
		...(dateRange
			? [
					{
						id: "date:clear",
						label: "clear date",
						keywords: ["date"],
						onSelect: () => setParams({ from: undefined, to: undefined }),
					} satisfies UnstableComboboxItem,
				]
			: []),
	];
	const categoryItems: UnstableComboboxItem[] = [
		{
			id: "category:uncategorized",
			label: "uncategorized",
			checked: uncategorized,
			onSelect: () => setParams({ cat: undefined, uncat: "1" }),
		},
		...(categories?.map<UnstableComboboxItem>((category) => ({
			id: `category:${category.id}`,
			label: category.name,
			checked: categoryId === category.id,
			onSelect: () => setParams({ cat: category.id, uncat: undefined }),
		})) ?? []),
	];
	const accountItems: UnstableComboboxItem[] =
		accounts?.map((account) => ({
			id: `account:${account.id}`,
			label: account.name,
			description: account.currency,
			keywords: [account.currency],
			checked: accountId === account.id,
			onSelect: () => setParams({ acc: account.id }),
		})) ?? [];
	const tagItems: UnstableComboboxItem[] =
		tags?.map((tag) => ({
			id: `tag:${tag.id}`,
			label: (
				<span className="flex min-w-0 items-center gap-1">
					<span className="text-gray-8">#</span>
					<span className="truncate">{tag.name}</span>
				</span>
			),
			textValue: tag.name,
			checked: tagIds.includes(tag.id),
			multi: true,
			onSelect: () => {
				const next = tagIds.includes(tag.id)
					? tagIds.filter((tid) => tid !== tag.id)
					: [...tagIds, tag.id];
				setParams({ tags: formatStringArrayParam(next) });
			},
		})) ?? [];
	const createTagNodes = ({
		normalizedQuery,
		query,
	}: {
		normalizedQuery: string;
		query: string;
	}) => [
		{
			type: "group" as const,
			id: "create-tag",
			label: "Create",
			items: [
				{
					id: `tag:create:${normalizedQuery}`,
					label: (
						<span className="flex min-w-0 items-center gap-1">
							<span className="text-gray-8">#</span>
							<span className="truncate">Create "{query.trim()}"</span>
						</span>
					),
					textValue: query,
					onSelect: ({ close }) => {
						close();
						void onCreateTag(query);
					},
				},
			],
		},
	];
	const currencyItems: UnstableComboboxItem[] =
		currencies?.map((code) => ({
			id: `currency:${code}`,
			label: <span className="font-mono">{code}</span>,
			textValue: code,
			checked: currencyIds.includes(code),
			multi: true,
			onSelect: () => {
				const next = currencyIds.includes(code)
					? currencyIds.filter((currency) => currency !== code)
					: [...currencyIds, code];
				setParams({ cur: formatStringArrayParam(next) });
			},
		})) ?? [];
	const rootItems: UnstableComboboxItem[] = [
		...(includeDate
			? [{ id: "go:date", label: "date", pageId: "date" } satisfies UnstableComboboxItem]
			: []),
		{ id: "go:category", label: "category", pageId: "category" },
		{ id: "go:account", label: "account", pageId: "account" },
		{
			id: "go:tags",
			label: (
				<>
					tags
					{tagIds.length > 0 && (
						<span className="ml-1 text-gray-10">({tagIds.length})</span>
					)}
				</>
			),
			textValue: "tags",
			pageId: "tags",
		},
		{
			id: "go:currency",
			label: (
				<>
					currency
					{currencyIds.length > 0 && (
						<span className="ml-1 text-gray-10">({currencyIds.length})</span>
					)}
				</>
			),
			textValue: "currency",
			pageId: "currency",
		},
	];

	const pages: UnstableComboboxConfig["pages"] = {
		root: {
			id: "root",
			title: "add filter",
			placeholder: "Add filter...",
			empty: "no filters",
			items: rootItems,
			queryNodes: [
				{
					id: "create-tag",
					placement: "replace-empty",
					when: ({ query, hasExactMatch }) =>
						query.trim().length > 0 &&
						!hasExactMatch((item) =>
							item.id.startsWith("tag:") ? (item.textValue ?? "") : "",
						),
					getNodes: createTagNodes,
				},
			],
			search: {
				sources: [
					localSearchSource({ id: "root", items: rootItems }),
					...(includeDate
						? [
								localSearchSource({
									id: "date",
									items: dateItems,
									label: "Date",
									breadcrumb: "date",
								}),
							]
						: []),
					localSearchSource({
						id: "category",
						items: categoryItems,
						label: "Category",
						breadcrumb: "category",
					}),
					localSearchSource({
						id: "account",
						items: accountItems,
						label: "Account",
						breadcrumb: "account",
					}),
					localSearchSource({
						id: "tags",
						items: tagItems,
						label: "Tags",
						breadcrumb: "tags",
					}),
					localSearchSource({
						id: "currency",
						items: currencyItems,
						label: "Currency",
						breadcrumb: "currency",
					}),
				],
			},
		},
		category: {
			id: "category",
			title: "category",
			placeholder: "Filter...",
			items: categoryItems,
			search: {
				sources: [localSearchSource({ id: "category", items: categoryItems })],
			},
		},
		account: {
			id: "account",
			title: "account",
			placeholder: "Filter...",
			empty: "no accounts",
			items: accountItems,
			search: {
				sources: [localSearchSource({ id: "account", items: accountItems })],
			},
		},
		tags: {
			id: "tags",
			title: "tags",
			placeholder: "Filter...",
			empty: "no tags",
			items: tagItems,
			queryNodes: [
				{
					id: "create-tag",
					placement: "after-results",
					when: ({ query, hasExactMatch }) =>
						query.trim().length > 0 && !hasExactMatch(),
					getNodes: createTagNodes,
				},
			],
			search: { sources: [localSearchSource({ id: "tags", items: tagItems })] },
		},
		currency: {
			id: "currency",
			title: "currency",
			placeholder: "Filter...",
			empty: "no currencies",
			items: currencyItems,
			search: {
				sources: [localSearchSource({ id: "currency", items: currencyItems })],
			},
		},
	};

	if (includeDate) {
		pages.date = {
			id: "date",
			title: "date",
			placeholder: "Filter...",
			items: [
				...dateItems.slice(0, datePresets.length),
				{ type: "separator" },
				...dateItems.slice(datePresets.length),
			],
			search: { sources: [localSearchSource({ id: "date", items: dateItems })] },
		};
	}

	return {
		rootPageId: "root",
		pages,
	};
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
