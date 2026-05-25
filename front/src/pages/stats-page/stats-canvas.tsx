import { useMemo } from "react";
import { useI18n } from "../../providers";
import { Spinner } from "../../components/spinner";
import { FastLink } from "../../components/link";
import { AppTooltip } from "../../components/tooltip";
import {
	useConvertedStatTransactionsQuery,
	useConvertedStatsSummaryQuery,
} from "../../lib/queries/stats";
import type { ConvertedStatTransactionRow } from "../../lib/queries/stats";
import type { ConversionMode } from "../../lib/db/settings";
import type { TransactionFilters } from "../../lib/queries/query-keys";
import type {
	DateRange,
	StatsCompareValue,
	StatsPeriodValue,
} from "./stats-page-types";
import {
	compareLabel,
	percentDelta,
	resolveBaseRange,
	resolveCompareRange,
} from "./stats-canvas-helpers";

const PERIODS: { value: StatsPeriodValue; label: string }[] = [
	{ value: "this-month", label: "This month" },
	{ value: "last-month", label: "Last month" },
	{ value: "last-30-days", label: "30 days" },
	{ value: "last-90-days", label: "90 days" },
	{ value: "last-12-months", label: "12 months" },
	{ value: "this-year", label: "This year" },
	{ value: "last-year", label: "Last year" },
];

const COMPARES: { value: StatsCompareValue; label: string }[] = [
	{ value: "previous", label: "Previous period" },
	{ value: "year-over-year", label: "YoY" },
	{ value: "none", label: "None" },
];

type Props = {
	reportingCurrency: string;
	queryReportingCurrency: string | undefined;
	mode: ConversionMode;
	maxStalenessDays: number;
	search?: string;
	filters?: TransactionFilters;
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	customFrom: string;
	customTo: string;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
	onRangeSelect: (range: DateRange) => void;
};

export function StatsCanvas(props: Props) {
	const { f } = useI18n();
	const now = useMemo(() => new Date(), []);
	const baseRange = useMemo(
		() => resolveBaseRange(props.period, { from: props.customFrom, to: props.customTo }, now),
		[props.period, props.customFrom, props.customTo, now],
	);
	const compareRange = useMemo(
		() => resolveCompareRange(baseRange, props.compare),
		[baseRange, props.compare],
	);

	const sharedInput = {
		reportingCurrency: props.queryReportingCurrency,
		mode: props.mode,
		maxStalenessDays: props.maxStalenessDays,
		search: props.search,
		filters: props.filters,
	};

	const summaryQ = useConvertedStatsSummaryQuery({
		...sharedInput,
		from: baseRange.from,
		to: baseRange.to,
	});
	const compareSummaryQ = useConvertedStatsSummaryQuery({
		...sharedInput,
		from: compareRange?.from ?? baseRange.from,
		to: compareRange?.to ?? baseRange.to,
		enabled: !!compareRange,
	});
	const txQ = useConvertedStatTransactionsQuery({
		...sharedInput,
		from: baseRange.from,
		to: baseRange.to,
	});
	const compareTxQ = useConvertedStatTransactionsQuery({
		...sharedInput,
		from: compareRange?.from ?? baseRange.from,
		to: compareRange?.to ?? baseRange.to,
		enabled: !!compareRange,
	});

	const totals = useMemo(() => deriveTotals(txQ.data ?? []), [txQ.data]);
	const compareTotals = useMemo(
		() => (compareRange ? deriveTotals(compareTxQ.data ?? []) : null),
		[compareTxQ.data, compareRange],
	);
	const expenseCategories = useMemo(() => {
		const current = aggregateCategories(txQ.data ?? [], "e");
		const previous = aggregateCategories(compareTxQ.data ?? [], "e");
		return mergeCategoryDeltas(current, previous).slice(0, 10);
	}, [txQ.data, compareTxQ.data]);
	const incomeCategoriesAll = useMemo(() => {
		const current = aggregateCategories(txQ.data ?? [], "i");
		const previous = aggregateCategories(compareTxQ.data ?? [], "i");
		return mergeCategoryDeltas(current, previous);
	}, [txQ.data, compareTxQ.data]);
	const topExpenseTxs = useMemo(
		() => pickTopExpenseTxs(txQ.data ?? [], 5),
		[txQ.data],
	);

	const isFetching =
		summaryQ.isFetching ||
		txQ.isFetching ||
		(!!compareRange && (compareSummaryQ.isFetching || compareTxQ.isFetching));
	const hasAnyData = summaryQ.data != null || txQ.data != null;

	return (
		<div className="space-y-8">
			<RailHeader
				period={props.period}
				compare={props.compare}
				onPeriodChange={props.onPeriodChange}
				onCompareChange={props.onCompareChange}
				onRangeSelect={props.onRangeSelect}
				baseRange={baseRange}
				compareRange={compareRange}
				isFetching={isFetching}
			/>

			<div
				className={
					"space-y-8 transition-opacity duration-200 " +
					(isFetching && hasAnyData ? "opacity-60" : "")
				}
			>
				<Hero
					totals={totals}
					compareTotals={compareTotals}
					compareLabelText={compareLabel(props.compare)}
					reportingCurrency={props.reportingCurrency}
					fAmount={f.amount}
				/>
				<CategoriesAndIncome
					expenseRows={expenseCategories.slice(0, 10)}
					incomeRows={incomeCategoriesAll}
					reportingCurrency={props.reportingCurrency}
					fAmount={f.amount}
					hasCompare={!!compareRange}
				/>
				{topExpenseTxs.length > 0 && (
					<TopExpenseTxs
						rows={topExpenseTxs}
						reportingCurrency={props.reportingCurrency}
						fAmount={f.amount}
						fShortDate={f.shortDate}
						baseRange={baseRange}
					/>
				)}
				<Footnote
					summary={summaryQ.data}
					maxStalenessDays={props.maxStalenessDays}
					mode={props.mode}
				/>
			</div>
		</div>
	);
}

type Totals = {
	income: number;
	expense: number;
	net: number;
	txCount: number;
};

function deriveTotals(rows: ConvertedStatTransactionRow[]): Totals {
	let income = 0;
	let expense = 0;
	for (const row of rows) {
		const amount = row.converted_amount ?? 0;
		if (row.bucket === "i") income += amount;
		else if (row.bucket === "e") expense += amount;
	}
	return {
		income,
		expense,
		net: income - expense,
		txCount: rows.length,
	};
}

type CategoryRow = {
	name: string;
	amount: number;
	previousAmount: number;
	delta: number;
};

function aggregateCategories(
	rows: ConvertedStatTransactionRow[],
	bucket: "i" | "e",
): { name: string; amount: number }[] {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (row.bucket !== bucket) continue;
		const amount = row.converted_amount ?? 0;
		map.set(row.cat_name, (map.get(row.cat_name) ?? 0) + amount);
	}
	return [...map.entries()]
		.map(([name, amount]) => ({ name, amount }))
		.sort((a, b) => b.amount - a.amount);
}

function mergeCategoryDeltas(
	current: { name: string; amount: number }[],
	previous: { name: string; amount: number }[],
): CategoryRow[] {
	const prevMap = new Map<string, number>();
	for (const row of previous) prevMap.set(row.name, row.amount);
	return current.map((row) => {
		const prev = prevMap.get(row.name) ?? 0;
		return {
			name: row.name,
			amount: row.amount,
			previousAmount: prev,
			delta: row.amount - prev,
		};
	});
}

function pickTopExpenseTxs(
	rows: ConvertedStatTransactionRow[],
	n: number,
): ConvertedStatTransactionRow[] {
	return rows
		.filter((r) => r.bucket === "e" && r.converted_amount != null)
		.sort((a, b) => (b.converted_amount ?? 0) - (a.converted_amount ?? 0))
		.slice(0, n);
}

function RailHeader(props: {
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
	onRangeSelect: (range: DateRange) => void;
	baseRange: DateRange;
	compareRange: DateRange | null;
	isFetching: boolean;
}) {
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-x-1 gap-y-2">
				{PERIODS.map((p) => (
					<Pill
						key={p.value}
						active={props.period === p.value}
						onClick={() => props.onPeriodChange(p.value)}
					>
						{p.label}
					</Pill>
				))}
			</div>
			<div className="flex items-center justify-between gap-3 text-[12px] text-gray-10">
				<div className="flex items-center gap-2 num">
					<span>{props.baseRange.from}</span>
					<span className="text-gray-a6">→</span>
					<span>{props.baseRange.to}</span>
					{props.compareRange && (
						<button
							type="button"
							onClick={() => {
								if (props.compareRange) props.onRangeSelect(props.compareRange);
							}}
							className="focus rounded-sm px-1 py-0.5 text-gray-9 transition-colors hover:bg-gray-a2 hover:text-gray-12"
						>
							{" "}
							· compared to {props.compareRange.from} → {props.compareRange.to}
						</button>
					)}
					<span
						aria-hidden={!props.isFetching}
						className={
							"ml-1 text-gray-10 transition-opacity " +
							(props.isFetching ? "opacity-100" : "opacity-0")
						}
					>
						<Spinner />
					</span>
				</div>
				<div className="flex items-center gap-1">
					{COMPARES.map((c) => (
						<Pill
							key={c.value}
							size="xs"
							active={props.compare === c.value}
							onClick={() => props.onCompareChange(c.value)}
						>
							{c.label}
						</Pill>
					))}
				</div>
			</div>
		</div>
	);
}

function Pill({
	active,
	onClick,
	children,
	size = "sm",
}: {
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
	size?: "xs" | "sm";
}) {
	const sizeCls = size === "xs" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]";
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				"focus rounded-md transition-colors " +
				sizeCls +
				" " +
				(active
					? "bg-gray-a3 text-gray-12"
					: "text-gray-11 hover:text-gray-12 hover:bg-gray-a2")
			}
		>
			{children}
		</button>
	);
}

function Hero(props: {
	totals: Totals;
	compareTotals: Totals | null;
	compareLabelText: string;
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
}) {
	const { totals, compareTotals, fAmount, reportingCurrency } = props;
	const netDelta = compareTotals ? percentDelta(totals.net, compareTotals.net) : null;
	const incDelta = compareTotals
		? percentDelta(totals.income, compareTotals.income)
		: null;
	const expDelta = compareTotals
		? percentDelta(totals.expense, compareTotals.expense)
		: null;
	const savingsRate = savingsRateOf(totals);
	const compareSavingsRate = compareTotals ? savingsRateOf(compareTotals) : null;
	const savingsRateDelta =
		savingsRate != null && compareSavingsRate != null
			? (savingsRate - compareSavingsRate) * 100
			: null;

	return (
		<section className="surface surface-bleed px-5 py-6">
			<div className="text-[10px] uppercase tracking-[0.06em] text-gray-10 font-medium">
				Net
			</div>
			<div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="num font-medium tracking-[-0.01em] text-gray-12 text-[36px] leading-none">
					{signed(totals.net, reportingCurrency, fAmount)}
				</span>
				<DeltaBadge value={netDelta} inverted={false} />
				<HeroCompareLabel
					previousValue={
						compareTotals ? signed(compareTotals.net, reportingCurrency, fAmount) : null
					}
				>
					{props.compareLabelText}
				</HeroCompareLabel>
			</div>
			<div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-gray-11">
				<SublineStat
					label="in"
					value={fAmount(totals.income, reportingCurrency)}
					delta={incDelta}
					previousValue={
						compareTotals ? fAmount(compareTotals.income, reportingCurrency) : null
					}
					inverted={false}
				/>
				<span className="text-gray-a6">·</span>
				<SublineStat
					label="out"
					value={fAmount(totals.expense, reportingCurrency)}
					delta={expDelta}
					previousValue={
						compareTotals ? fAmount(compareTotals.expense, reportingCurrency) : null
					}
					tooltipPlacement="bottom"
					inverted
				/>
				<span className="text-gray-a6">·</span>
				<SublineStat
					label="saved"
					value={savingsRate == null ? "—" : `${(savingsRate * 100).toFixed(1)}%`}
					delta={savingsRateDelta}
					previousValue={
						compareSavingsRate == null
							? null
							: `${(compareSavingsRate * 100).toFixed(1)}%`
					}
					inverted={false}
					deltaUnit="pp"
				/>
			</div>
		</section>
	);
}

function HeroCompareLabel({
	children,
	previousValue,
}: {
	children: React.ReactNode;
	previousValue: string | null;
}) {
	if (!previousValue) {
		return <span className="text-[11px] text-gray-10">{children}</span>;
	}

	return (
		<PreviousValueTooltip
			previousValue={previousValue}
			className="text-[11px] text-gray-10"
		>
			{children}
		</PreviousValueTooltip>
	);
}

function SublineStat(props: {
	label: string;
	value: string;
	delta: number | null;
	previousValue: string | null;
	inverted: boolean;
	deltaUnit?: "%" | "pp";
	tooltipPlacement?: "top" | "bottom";
}) {
	return (
		<span className="flex items-baseline gap-1.5">
			<span className="num text-gray-12">{props.value}</span>
			<span className="text-gray-10">{props.label}</span>
			<PreviousValueTooltip
				previousValue={props.previousValue}
				placement={props.tooltipPlacement}
			>
				<DeltaBadge
					value={props.delta}
					inverted={props.inverted}
					unit={props.deltaUnit}
				/>
			</PreviousValueTooltip>
		</span>
	);
}

function PreviousValueTooltip({
	children,
	previousValue,
	className,
	placement,
}: {
	children: React.ReactNode;
	previousValue: string | null;
	className?: string;
	placement?: "top" | "bottom";
}) {
	if (!previousValue) return children;

	return (
		<AppTooltip
			className={className}
			placement={placement}
			content={
				<>
					<span className="text-gray-10">Previous</span>{" "}
					<span className="num text-gray-12">{previousValue}</span>
				</>
			}
		>
			{children}
		</AppTooltip>
	);
}

function savingsRateOf(totals: Totals): number | null {
	if (totals.income <= 0) return null;
	return totals.net / totals.income;
}

function signed(
	value: number,
	currency: string,
	fAmount: (amount: number, currency: string) => string,
) {
	if (value > 0) return `+${fAmount(value, currency)}`;
	if (value < 0) return `−${fAmount(Math.abs(value), currency)}`;
	return fAmount(value, currency);
}

function DeltaBadge({
	value,
	inverted,
	unit = "%",
}: {
	value: number | null;
	inverted?: boolean;
	unit?: "%" | "pp";
}) {
	if (value == null) {
		return <span className="text-gray-9 num">—</span>;
	}
	const positive = inverted ? value < 0 : value > 0;
	const negative = inverted ? value > 0 : value < 0;
	const sign = value > 0 ? "+" : value < 0 ? "−" : "";
	const cls = positive
		? "text-green-11"
		: negative
			? "text-orange-11"
			: "text-gray-10";
	return (
		<span className={"num " + cls}>
			{sign}
			{Math.abs(value).toFixed(1)}
			{unit}
		</span>
	);
}

function displayCategoryName(name: string) {
	return name === "__uncategorized__" ? "Uncategorized" : name;
}

function CategoriesAndIncome(props: {
	expenseRows: CategoryRow[];
	incomeRows: CategoryRow[];
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	hasCompare: boolean;
}) {
	const incomeRows = props.incomeRows.slice(0, 10);
	const sharedMaxExpense = computeMax(props.expenseRows);
	const sharedMaxIncome = computeMax(incomeRows);
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<h2 className="text-[13px] font-medium text-gray-12">Top categories</h2>
				<span className="text-[11px] text-gray-10">Expenses · Income</span>
			</header>
			<div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
				<CategoryList
					rows={props.expenseRows}
					reportingCurrency={props.reportingCurrency}
					fAmount={props.fAmount}
					hasCompare={props.hasCompare}
					kind="expense"
					heading="Expenses"
					emptyText="No expenses in this period."
					sharedMax={sharedMaxExpense}
				/>
				<CategoryList
					rows={incomeRows}
					reportingCurrency={props.reportingCurrency}
					fAmount={props.fAmount}
					hasCompare={props.hasCompare}
					kind="income"
					heading="Income"
					emptyText="No income in this period."
					sharedMax={sharedMaxIncome}
				/>
			</div>
		</section>
	);
}

function computeMax(rows: CategoryRow[]): number {
	return Math.max(1, ...rows.flatMap((r) => [r.amount, r.previousAmount]));
}

function CategoryList(props: {
	rows: CategoryRow[];
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	hasCompare: boolean;
	kind: "income" | "expense";
	heading: string;
	emptyText: string;
	sharedMax: number;
}) {
	return (
		<div>
			<div className="mb-2 text-[10px] uppercase tracking-[0.06em] text-gray-10 font-medium">
				{props.heading}
			</div>
			{props.rows.length === 0 ? (
				<EmptyHint>{props.emptyText}</EmptyHint>
			) : (
				<ul className="space-y-2.5 text-[12px]">
					{props.rows.map((row) => (
						<CategoryRowItem
							key={row.name}
							row={row}
							reportingCurrency={props.reportingCurrency}
							fAmount={props.fAmount}
							hasCompare={props.hasCompare}
							kind={props.kind}
							sharedMax={props.sharedMax}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function CategoryRowItem(props: {
	row: CategoryRow;
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	hasCompare: boolean;
	kind: "income" | "expense";
	sharedMax: number;
}) {
	const { row, sharedMax, kind, hasCompare } = props;
	const barCls = kind === "income" ? "bg-green-a8" : "bg-red-a8";
	const direction: "up" | "down" | null =
		hasCompare && row.previousAmount > 0 && row.amount !== row.previousAmount
			? row.amount > row.previousAmount
				? "up"
				: "down"
			: null;
	const goodDirection = kind === "income" ? "up" : "down";
	const arrowCls =
		direction == null
			? ""
			: direction === goodDirection
				? "text-green-11"
				: "text-orange-11";
	const showTick =
		hasCompare && row.previousAmount > 0 && row.previousAmount !== row.amount;
	return (
		<li className="space-y-1">
			<div className="flex items-baseline justify-between gap-3">
				<span className="truncate text-gray-12">{displayCategoryName(row.name)}</span>
				<span className="flex shrink-0 items-baseline gap-1.5">
					{hasCompare && row.previousAmount > 0 && (
						<>
							<span className="num text-gray-10">
								{props.fAmount(row.previousAmount, props.reportingCurrency)}
							</span>
							<span aria-hidden className={arrowCls || "text-gray-9"}>
								→
							</span>
						</>
					)}
					<span className="num text-gray-12">
						{props.fAmount(row.amount, props.reportingCurrency)}
					</span>
				</span>
			</div>
			<div className="relative h-[6px]">
				<div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 overflow-hidden rounded-full bg-gray-a2">
					<div
						className={"absolute inset-y-0 left-0 rounded-full " + barCls}
						style={{ width: `${(row.amount / sharedMax) * 100}%` }}
					/>
				</div>
				{showTick && (
					<div
						className="absolute inset-y-0 w-[1.5px] rounded-full bg-gray-12"
						style={{ left: `${(row.previousAmount / sharedMax) * 100}%` }}
						title={`Prev: ${props.fAmount(row.previousAmount, props.reportingCurrency)}`}
					/>
				)}
			</div>
		</li>
	);
}

function TopExpenseTxs(props: {
	rows: ConvertedStatTransactionRow[];
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	fShortDate: Intl.DateTimeFormat;
	baseRange: DateRange;
}) {
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<h2 className="text-[13px] font-medium text-gray-12">Biggest expenses</h2>
				<span className="text-[11px] text-gray-10">Top 5 in period</span>
			</header>
			<ul className="space-y-2 text-[12px]">
				{props.rows.map((row) => {
					const params = new URLSearchParams();
					if (row.counter_party) params.set("q", row.counter_party);
					params.set("from", props.baseRange.from);
					params.set("to", props.baseRange.to);
					const href = `/txs?${params.toString()}`;
					const amount = row.converted_amount ?? 0;
					const dateLabel = props.fShortDate.format(new Date(row.eff_date));
					return (
						<li key={row.id}>
							<FastLink
								href={href}
								className="focus -mx-2 flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-gray-a2"
							>
								<span className="min-w-0 flex-1 truncate">
									<span className="text-gray-12">
										{row.counter_party || "(no counterparty)"}
									</span>
									<span className="ml-2 text-gray-10">
										{displayCategoryName(row.cat_name)}
									</span>
								</span>
								<span className="flex shrink-0 items-baseline gap-2 num">
									<span className="text-gray-10 text-[11px]">{dateLabel}</span>
									<span className="text-gray-12">
										{props.fAmount(amount, props.reportingCurrency)}
									</span>
								</span>
							</FastLink>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
function Footnote(props: {
	summary?: {
		coverage_count_ratio: number;
		coverage_amount_ratio: number;
		missing_by_currency: Array<{ currency: string; count: number }>;
	};
	maxStalenessDays: number;
	mode: ConversionMode;
}) {
	const summary = props.summary;
	if (!summary) return null;
	const coverPct = (summary.coverage_amount_ratio * 100).toFixed(1);
	return (
		<p className="text-[11px] text-gray-10">
			FX coverage {coverPct}% (mode: {props.mode}, max staleness {props.maxStalenessDays}d).
			{summary.missing_by_currency.length > 0 && (
				<>
					{" "}
					Missing rates:{" "}
					{summary.missing_by_currency
						.map((m) => `${m.currency} (${m.count})`)
						.join(", ")}
					.
				</>
			)}
		</p>
	);
}

function EmptyHint({ children }: { children: React.ReactNode }) {
	return <p className="text-[12px] text-gray-10">{children}</p>;
}
