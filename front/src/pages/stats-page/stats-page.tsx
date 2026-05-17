import { useMemo } from "react";
import { useLocation, useSearchParams } from "wouter";
import { useTransactionYearsQuery } from "../../lib/queries/stats";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "../../components/tabs";
import { useAppSettingsQuery } from "../../lib/queries/settings";
import { DesktopYearMonthExplorer } from "./desktop-year-month-explorer";
import { StatsOverviewPanel } from "./stats-overview-panel";
import { Input } from "../../components/input";
import { CategoryCombobox } from "../../components/category-combobox";
import { Combobox } from "../../components/combobox";
import { IconChevronsUpDown } from "../../components/icons/chevrons-up-down";
import { useCategoryOptionsQuery } from "../../lib/queries/categories";
import { useAccountsQuery } from "../../lib/queries/accounts";
import { useTransactionCurrenciesQuery } from "../../lib/queries/transactions";
import { useTagOptionsQuery } from "../../lib/queries/tags";
import { FastLink } from "../../components/link";
import type { TransactionFilters } from "../../lib/queries/query-keys";
import { TagMultiCombobox } from "../../components/tag-combobox";
import { CurrencyMultiCombobox } from "../../components/currency-multi-combobox";
import {
	formatStringArrayParam,
	parseStringArrayParam,
} from "../../lib/string-array-param";
import {
	type StatsAmountMode,
	type DateRange,
	type StatsCompareValue,
	type StatsPeriodValue,
	type StatsTabValue,
} from "./stats-page-types";

function parseStatsTabValue(value: string | null): StatsTabValue {
	return value === "stats-1" ? "stats-1" : "stats-2";
}

function parseStatsPeriodValue(value: string | null): StatsPeriodValue {
	if (
		value === "this-month" ||
		value === "last-month" ||
		value === "last-7-days" ||
		value === "last-30-days" ||
		value === "last-90-days" ||
		value === "last-12-months" ||
		value === "this-year" ||
		value === "last-year" ||
		value === "custom"
	) {
		return value;
	}
	return "this-month";
}

function parseStatsAmountMode(value: string | null): StatsAmountMode {
	return value === "per-day" ? "per-day" : "total";
}

function parseStatsCompareValue(value: string | null): StatsCompareValue {
	if (value === "year-over-year" || value === "none") return value;
	return "previous";
}

function formatIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null): Date | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date;
}

function startOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function defaultCustomRange(now: Date): DateRange {
	const from = formatIsoDate(startOfMonth(now));
	const to = formatIsoDate(now);
	return { from, to };
}

function normalizeCustomRange(from: string, to: string): DateRange {
	const fromDate = parseIsoDate(from);
	const toDate = parseIsoDate(to);
	if (!fromDate || !toDate) return { from, to };
	if (fromDate <= toDate) return { from, to };
	return { from: to, to: from };
}

export function StatsPage() {
	const settings = useAppSettingsQuery();
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();

	const nowUtc = useMemo(() => new Date(), []);
	const activeTab = parseStatsTabValue(searchParams.get("tab"));
	const period = parseStatsPeriodValue(searchParams.get("period"));
	const compare = parseStatsCompareValue(searchParams.get("compare"));
	const amountMode = parseStatsAmountMode(searchParams.get("amount"));
	const q = searchParams.get("q") ?? "";
	const categoryId = searchParams.get("cat") ?? "";
	const accountId = searchParams.get("acc") ?? "";
	const currencyIds = parseStringArrayParam(searchParams.get("cur"));
	const tagIds = parseStringArrayParam(searchParams.get("tags"));
	const uncategorized = searchParams.get("uncat") === "1";

	const defaultCustom = useMemo(() => defaultCustomRange(nowUtc), [nowUtc]);
	const rawCustomFrom = parseIsoDate(searchParams.get("from"))
		? searchParams.get("from")!
		: defaultCustom.from;
	const rawCustomTo = parseIsoDate(searchParams.get("to"))
		? searchParams.get("to")!
		: defaultCustom.to;
	const normalizedCustom = useMemo(
		() => normalizeCustomRange(rawCustomFrom, rawCustomTo),
		[rawCustomFrom, rawCustomTo],
	);
	const customFrom = normalizedCustom.from;
	const customTo = normalizedCustom.to;

	const reportingCurrency = settings.data?.reporting_currency ?? "EUR";
	const mode = settings.data?.conversion_mode ?? "strict";
	const maxStalenessDays = settings.data?.max_staleness_days ?? 7;

	const yearStats = useTransactionYearsQuery();
	const yearRows = yearStats.data ?? [];
	const categories = useCategoryOptionsQuery();
	const accounts = useAccountsQuery();
	const currencies = useTransactionCurrenciesQuery();
	const tags = useTagOptionsQuery();

	const filters: TransactionFilters = {};
	if (categoryId) filters.category_id = categoryId;
	if (accountId) filters.account_id = accountId;
	if (currencyIds.length) filters.currencies = currencyIds;
	if (tagIds.length) filters.tag_ids = tagIds;
	if (uncategorized) filters.uncategorized = true;
	const activeFilters = Object.keys(filters).length > 0 ? filters : undefined;
	const scopeParams: Record<string, string | undefined> = {
		q: q || undefined,
		cat: categoryId || undefined,
		acc: accountId || undefined,
		cur: formatStringArrayParam(currencyIds),
		tags: formatStringArrayParam(tagIds),
		uncat: uncategorized ? "1" : undefined,
	};
	const hasScope = !!(
		q ||
		categoryId ||
		accountId ||
		currencyIds.length ||
		tagIds.length ||
		uncategorized
	);
	const transactionsHref = buildPath("/txs", scopeParams);

	const setStatsParams = (updates: Record<string, string | undefined>) => {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const qs = params.toString();
		navigate(qs ? `/stats?${qs}` : "/stats");
	};

	return (
		<div className="w-full mx-auto max-w-[900px] mt-14 px-4">
			<h1 className="font-medium text-2xl font-cool mb-4">stats</h1>

			{(settings.isLoading || yearStats.isLoading) && (
				<p className="text-sm text-gray-10">loading...</p>
			)}
			{yearStats.isError && (
				<pre className="text-sm text-red-11 whitespace-pre-wrap">{String(yearStats.error)}</pre>
			)}

			<TabsRoot
				value={activeTab}
					onValueChange={(value) => {
						if (value === "stats-1" || value === "stats-2") {
							setStatsParams({ tab: value });
					}
				}}
			>
				<TabsList aria-label="stats versions">
					<TabsTab value="stats-1">stats 1</TabsTab>
					<TabsTab value="stats-2">stats 2</TabsTab>
				</TabsList>

					<TabsPanel value="stats-1">
						<DesktopYearMonthExplorer
							yearRows={yearRows}
							reportingCurrency={reportingCurrency}
							queryReportingCurrency={settings.data?.reporting_currency}
							mode={mode}
							maxStalenessDays={maxStalenessDays}
						/>
					</TabsPanel>

				<TabsPanel value="stats-2">
					<div className="mb-4 space-y-2">
						<div className="flex items-center justify-between gap-3">
							<div className="text-xs font-mono text-gray-11">
								{hasScope ? "scope" : "scope (all transactions)"}
							</div>
							<FastLink
								href={transactionsHref}
								className="text-xs font-mono text-gray-11 hover:text-gray-12 hover:underline"
							>
								view matching txs →
							</FastLink>
						</div>
						<StatsScopeControls
							q={q}
							categoryId={categoryId}
							accountId={accountId}
							currencyIds={currencyIds}
							tagIds={tagIds}
							uncategorized={uncategorized}
							hasScope={hasScope}
							categories={categories.data}
							accounts={accounts.data}
							currencies={currencies.data}
							tags={tags.data}
							setParams={setStatsParams}
						/>
					</div>
					<StatsOverviewPanel
						reportingCurrency={reportingCurrency}
						queryReportingCurrency={settings.data?.reporting_currency}
						mode={mode}
						maxStalenessDays={maxStalenessDays}
						search={q || undefined}
						filters={activeFilters}
						scopeParams={scopeParams}
						period={period}
						compare={compare}
						amountMode={amountMode}
						customFrom={customFrom}
						customTo={customTo}
						onPeriodChange={(value) => {
							if (value === "custom") {
								setStatsParams({
									period: value,
									from: customFrom,
									to: customTo,
								});
								return;
							}
							setStatsParams({
								period: value,
								from: undefined,
								to: undefined,
							});
						}}
						onCompareChange={(value) => setStatsParams({ compare: value })}
						onAmountModeChange={(value) =>
							setStatsParams({ amount: value === "per-day" ? value : undefined })
						}
						onCustomRangeChange={(from, to) =>
							setStatsParams({
								period: "custom",
								from,
								to,
							})
						}
					/>
					</TabsPanel>
			</TabsRoot>
		</div>
	);
}

function buildPath(path: string, params: Record<string, string | undefined>) {
	const next = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) next.set(key, value);
	}
	const qs = next.toString();
	return qs ? `${path}?${qs}` : path;
}

function StatsScopeControls({
	q,
	categoryId,
	accountId,
	currencyIds,
	tagIds,
	uncategorized,
	hasScope,
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
	hasScope: boolean;
	categories: Array<{ id: string; name: string }> | undefined;
	accounts: Array<{ id: string; name: string; currency: string }> | undefined;
	currencies: string[] | undefined;
	tags: Array<{ id: string; name: string }> | undefined;
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
			<div className="grid gap-2 sm:grid-cols-3">
				<CategoryCombobox
					size="sm"
					className="min-w-0"
					value={uncategorized ? "__uncat__" : categoryId}
					onChange={(nextValue) => {
						if (nextValue === "__uncat__") {
							setParams({ cat: undefined, uncat: "1" });
							return;
						}
						setParams({ cat: nextValue || undefined, uncat: undefined });
					}}
					placeholder="all categories"
					items={[
						{ id: "", value: "", label: "all categories" },
						{ id: "__uncat__", value: "__uncat__", label: "uncategorized" },
						...(categories?.map((category) => ({
							id: category.id,
							value: category.id,
							label: category.name,
						})) ?? []),
					]}
				/>
				<AccountFilterCombobox
					value={accountId}
					accounts={accounts}
					onChange={(nextValue) => setParams({ acc: nextValue || undefined })}
				/>
				<CurrencyMultiCombobox
					currencies={currencies}
					value={currencyIds}
					onChange={(nextCurrencyIds) =>
						setParams({ cur: formatStringArrayParam(nextCurrencyIds) })
					}
					placeholder="all currencies"
					size="sm"
				/>
			</div>
			<div>
				<TagMultiCombobox
					items={tags ?? []}
					value={tagIds}
					onChange={(nextTagIds) =>
						setParams({ tags: formatStringArrayParam(nextTagIds) })
					}
					placeholder="filter by tag..."
					size="sm"
				/>
			</div>
			{hasScope && (
				<button
					type="button"
					className="text-xs text-gray-10 hover:text-gray-12 underline"
					onClick={() =>
						setParams({
							q: undefined,
							cat: undefined,
							acc: undefined,
							cur: undefined,
							tags: undefined,
							uncat: undefined,
						})
					}
				>
					clear scope
				</button>
			)}
		</div>
	);
}

type AccountFilterItem = {
	value: string;
	label: string;
	currency?: string;
};

function AccountFilterCombobox({
	value,
	accounts,
	onChange,
}: {
	value: string;
	accounts: Array<{ id: string; name: string; currency: string }> | undefined;
	onChange: (value: string) => void;
}) {
	const items = useMemo<AccountFilterItem[]>(
		() => [
			{
				value: "__all__",
				label: "all accounts",
			},
			...(accounts ?? []).map((account) => ({
				value: account.id,
				label: account.name,
				currency: account.currency,
			})),
		],
		[accounts],
	);

	const selectedItem =
		items.find((item) => item.value === (value || "__all__")) ?? items[0];

	return (
		<Combobox.Root
			items={items}
			value={selectedItem}
			onValueChange={(next) => {
				if (!next || next.value === "__all__") {
					onChange("");
					return;
				}
				onChange(next.value);
			}}
			itemToStringLabel={(item) => item.label}
			isItemEqualToValue={(item, selected) => item.value === selected.value}
			autoHighlight
		>
			<Combobox.Trigger<AccountFilterItem, AccountFilterItem | null>
				className="focus field-trigger data-[disabled]:opacity-60 flex h-8 min-w-0 items-center justify-between gap-2 overflow-hidden pl-2.5 pr-2 text-sm"
			>
				{({ selectedValue }) => (
					<>
						<span className="truncate text-gray-12">
							{selectedValue?.label ?? "all accounts"}
						</span>
						<Combobox.Icon className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</Combobox.Icon>
					</>
				)}
			</Combobox.Trigger>
			<Combobox.Content
				searchPlaceholder="search accounts..."
				empty="No accounts found."
				size="sm"
			>
				<Combobox.List<AccountFilterItem>>
					{(item) => (
						<Combobox.Item key={item.value} value={item} size="sm">
							<div className="flex w-full items-center justify-between gap-2">
								<span className="truncate">{item.label}</span>
								{item.currency ? (
									<span className="shrink-0 text-xs text-gray-10">
										{item.currency}
									</span>
								) : null}
							</div>
						</Combobox.Item>
					)}
				</Combobox.List>
			</Combobox.Content>
		</Combobox.Root>
	);
}
