import { useMemo } from "react";
import { useI18n } from "../../providers";
import { Spinner } from "../../components/spinner";
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
	addDays,
	compareLabel,
	parseIsoDate,
	pickGranularity,
	percentDelta,
	resolveBaseRange,
	resolveCompareRange,
	type BucketGranularity,
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
	scopeParams: Record<string, string | undefined>;
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	customFrom: string;
	customTo: string;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
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
	const granularity = pickGranularity(baseRange);

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
	const buckets = useMemo(
		() => bucketize(txQ.data ?? [], baseRange, granularity),
		[txQ.data, baseRange, granularity],
	);
	const categories = useMemo(() => {
		const current = aggregateCategories(txQ.data ?? [], "e");
		const previous = aggregateCategories(compareTxQ.data ?? [], "e");
		return mergeCategoryDeltas(current, previous).slice(0, 10);
	}, [txQ.data, compareTxQ.data]);
	const counterparties = useMemo(() => {
		const current = aggregateCounterparties(txQ.data ?? []);
		const previousSet = new Set(
			aggregateCounterparties(compareTxQ.data ?? []).map((r) => r.name),
		);
		return current.slice(0, 10).map((row) => ({
			...row,
			isNew: compareRange ? !previousSet.has(row.name) : false,
		}));
	}, [txQ.data, compareTxQ.data, compareRange]);
	const currencyMix = useMemo(
		() => aggregateCurrencies(txQ.data ?? [], props.reportingCurrency),
		[txQ.data, props.reportingCurrency],
	);

	const loading =
		summaryQ.isLoading ||
		txQ.isLoading ||
		(compareRange && (compareSummaryQ.isLoading || compareTxQ.isLoading));

	return (
		<div className="space-y-8">
			<RailHeader
				period={props.period}
				compare={props.compare}
				onPeriodChange={props.onPeriodChange}
				onCompareChange={props.onCompareChange}
				baseRange={baseRange}
				compareRange={compareRange}
			/>

			{loading ? (
				<div className="flex h-32 items-center justify-center text-gray-10">
					<Spinner />
				</div>
			) : (
				<>
					<Hero
						totals={totals}
						compareTotals={compareTotals}
						compareLabelText={compareLabel(props.compare)}
						reportingCurrency={props.reportingCurrency}
						fAmount={f.amount}
					/>
					<CashflowStrip
						buckets={buckets}
						granularity={granularity}
						reportingCurrency={props.reportingCurrency}
						fAmount={f.amount}
					/>
					<div className="grid gap-6 lg:grid-cols-2">
						<CategoryList
							rows={categories}
							reportingCurrency={props.reportingCurrency}
							fAmount={f.amount}
							scopeParams={props.scopeParams}
							hasCompare={!!compareRange}
						/>
						<CounterpartyList
							rows={counterparties}
							reportingCurrency={props.reportingCurrency}
							fAmount={f.amount}
							hasCompare={!!compareRange}
						/>
					</div>
					<CurrencyMix
						rows={currencyMix}
						reportingCurrency={props.reportingCurrency}
						fAmount={f.amount}
					/>
					<Footnote
						summary={summaryQ.data}
						maxStalenessDays={props.maxStalenessDays}
						mode={props.mode}
					/>
				</>
			)}
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

type Bucket = {
	key: string;
	label: string;
	income: number;
	expense: number;
	net: number;
};

function bucketKeyFor(date: Date, granularity: BucketGranularity): string {
	if (granularity === "day") {
		return date.toISOString().slice(0, 10);
	}
	if (granularity === "week") {
		const monday = new Date(date.getTime());
		const day = monday.getUTCDay();
		const diff = (day + 6) % 7;
		monday.setUTCDate(monday.getUTCDate() - diff);
		return monday.toISOString().slice(0, 10);
	}
	return date.toISOString().slice(0, 7);
}

function bucketLabelFor(key: string, granularity: BucketGranularity, locale = "fi-FI") {
	if (granularity === "month") {
		const [y, m] = key.split("-");
		const dt = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
		return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(dt);
	}
	const dt = new Date(`${key}T00:00:00Z`);
	if (granularity === "week") {
		return new Intl.DateTimeFormat(locale, {
			month: "numeric",
			day: "numeric",
			timeZone: "UTC",
		}).format(dt);
	}
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		timeZone: "UTC",
	}).format(dt);
}

function bucketize(
	rows: ConvertedStatTransactionRow[],
	range: DateRange,
	granularity: BucketGranularity,
): Bucket[] {
	const map = new Map<string, Bucket>();
	const from = parseIsoDate(range.from);
	const to = parseIsoDate(range.to);
	if (!from || !to) return [];

	for (let cursor = new Date(from.getTime()); cursor <= to; cursor = addDays(cursor, 1)) {
		const key = bucketKeyFor(cursor, granularity);
		if (!map.has(key)) {
			map.set(key, {
				key,
				label: bucketLabelFor(key, granularity),
				income: 0,
				expense: 0,
				net: 0,
			});
		}
	}

	for (const row of rows) {
		const date = parseIsoDate(row.eff_date);
		if (!date) continue;
		const key = bucketKeyFor(date, granularity);
		const bucket = map.get(key);
		if (!bucket) continue;
		const amount = row.converted_amount ?? 0;
		if (row.bucket === "i") bucket.income += amount;
		else if (row.bucket === "e") bucket.expense += amount;
		bucket.net = bucket.income - bucket.expense;
	}

	return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
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

type CounterpartyRow = {
	name: string;
	amount: number;
	count: number;
};

function aggregateCounterparties(rows: ConvertedStatTransactionRow[]): CounterpartyRow[] {
	const map = new Map<string, CounterpartyRow>();
	for (const row of rows) {
		if (row.bucket !== "e") continue;
		const existing = map.get(row.counter_party) ?? {
			name: row.counter_party,
			amount: 0,
			count: 0,
		};
		existing.amount += row.converted_amount ?? 0;
		existing.count += 1;
		map.set(row.counter_party, existing);
	}
	return [...map.values()].sort((a, b) => b.amount - a.amount);
}

type CurrencyRow = {
	currency: string;
	amount: number;
	count: number;
};

function aggregateCurrencies(
	rows: ConvertedStatTransactionRow[],
	reportingCurrency: string,
): CurrencyRow[] {
	const map = new Map<string, CurrencyRow>();
	for (const row of rows) {
		if (row.bucket !== "e") continue;
		const cur = row.original_currency;
		const existing = map.get(cur) ?? { currency: cur, amount: 0, count: 0 };
		existing.amount += row.converted_amount ?? 0;
		existing.count += 1;
		map.set(cur, existing);
	}
	return [...map.values()]
		.filter((row) => row.currency !== reportingCurrency)
		.sort((a, b) => b.amount - a.amount);
}

function RailHeader(props: {
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
	baseRange: DateRange;
	compareRange: DateRange | null;
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
						<span className="text-gray-9">
							{" "}
							· compared to {props.compareRange.from} → {props.compareRange.to}
						</span>
					)}
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
	const { totals, compareTotals } = props;
	const netDelta = compareTotals ? percentDelta(totals.net, compareTotals.net) : null;
	const incDelta = compareTotals
		? percentDelta(totals.income, compareTotals.income)
		: null;
	const expDelta = compareTotals
		? percentDelta(totals.expense, compareTotals.expense)
		: null;

	return (
		<section className="surface surface-bleed grid divide-y divide-gray-a3 sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
			<StatCell
				label="Net"
				value={signed(totals.net, props.reportingCurrency, props.fAmount)}
				delta={netDelta}
				deltaInverted={false}
				note={props.compareLabelText}
				accent={totals.net >= 0 ? "pos" : "neg"}
				large
			/>
			<StatCell
				label="Income"
				value={props.fAmount(totals.income, props.reportingCurrency)}
				delta={incDelta}
				deltaInverted={false}
				note={props.compareLabelText}
				accent="pos"
			/>
			<StatCell
				label="Expense"
				value={props.fAmount(totals.expense, props.reportingCurrency)}
				delta={expDelta}
				deltaInverted
				note={props.compareLabelText}
				accent="neg"
			/>
		</section>
	);
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

function StatCell({
	label,
	value,
	delta,
	deltaInverted,
	note,
	accent,
	large,
}: {
	label: string;
	value: string;
	delta: number | null;
	deltaInverted: boolean;
	note: string;
	accent: "pos" | "neg" | "neutral";
	large?: boolean;
}) {
	const valueCls =
		"num font-medium tracking-[-0.01em] " + (large ? "text-[28px]" : "text-[20px]") +
		" " +
		(accent === "pos" ? "text-gray-12" : accent === "neg" ? "text-gray-12" : "text-gray-12");
	return (
		<div className="px-5 py-5">
			<div className="text-[10px] uppercase tracking-[0.06em] text-gray-10 font-medium">
				{label}
			</div>
			<div className={"mt-2 " + valueCls}>{value}</div>
			<div className="mt-2 flex items-center gap-2 text-[11px] text-gray-10">
				<DeltaBadge value={delta} inverted={deltaInverted} />
				<span>{note}</span>
			</div>
		</div>
	);
}

function DeltaBadge({ value, inverted }: { value: number | null; inverted?: boolean }) {
	if (value == null) {
		return <span className="text-gray-9">—</span>;
	}
	const positive = inverted ? value < 0 : value > 0;
	const negative = inverted ? value > 0 : value < 0;
	const sign = value > 0 ? "+" : value < 0 ? "−" : "";
	const cls = positive
		? "text-green-11"
		: negative
			? "text-red-11"
			: "text-gray-10";
	return (
		<span className={"num " + cls}>
			{sign}
			{Math.abs(value).toFixed(1)}%
		</span>
	);
}

function CashflowStrip(props: {
	buckets: Bucket[];
	granularity: BucketGranularity;
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
}) {
	const max = Math.max(
		1,
		...props.buckets.flatMap((b) => [b.income, b.expense]),
	);
	const condensed = props.granularity === "day" && props.buckets.length > 31;
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<div>
					<h2 className="text-[13px] font-medium text-gray-12">Cashflow</h2>
					<p className="text-[11px] text-gray-10 mt-0.5">
						Per {props.granularity} · income vs expense
					</p>
				</div>
				<div className="flex items-center gap-3 text-[11px] text-gray-10">
					<LegendDot className="bg-green-9" /> Income
					<LegendDot className="bg-red-9" /> Expense
				</div>
			</header>
			<div className="flex h-32 items-end gap-px">
				{props.buckets.map((bucket) => (
					<div
						key={bucket.key}
						className="flex flex-1 min-w-0 flex-col justify-end gap-px group"
						title={`${bucket.label} · in ${props.fAmount(bucket.income, props.reportingCurrency)} · out ${props.fAmount(bucket.expense, props.reportingCurrency)}`}
					>
						<div
							className="bg-green-a8 group-hover:bg-green-a10 transition-colors rounded-sm"
							style={{ height: `${(bucket.income / max) * 100}%`, minHeight: bucket.income > 0 ? 2 : 0 }}
						/>
						<div
							className="bg-red-a8 group-hover:bg-red-a10 transition-colors rounded-sm"
							style={{ height: `${(bucket.expense / max) * 100}%`, minHeight: bucket.expense > 0 ? 2 : 0 }}
						/>
					</div>
				))}
			</div>
			<div className="mt-2 flex gap-px text-[10px] text-gray-10">
				{props.buckets.map((b, i) => {
					const showLabel = !condensed || i % Math.ceil(props.buckets.length / 12) === 0;
					return (
						<div key={b.key} className="flex-1 min-w-0 text-center truncate">
							{showLabel ? b.label : ""}
						</div>
					);
				})}
			</div>
		</section>
	);
}

function LegendDot({ className }: { className: string }) {
	return (
		<span
			aria-hidden
			className={"inline-block size-2 rounded-full " + className}
		/>
	);
}

function CategoryList(props: {
	rows: CategoryRow[];
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	scopeParams: Record<string, string | undefined>;
	hasCompare: boolean;
}) {
	const max = Math.max(1, ...props.rows.map((r) => r.amount));
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<h2 className="text-[13px] font-medium text-gray-12">Top categories</h2>
				<span className="text-[11px] text-gray-10">By expense</span>
			</header>
			{props.rows.length === 0 ? (
				<EmptyHint>No expenses in this period.</EmptyHint>
			) : (
				<ul className="space-y-2">
					{props.rows.map((row) => {
						const displayName =
							row.name === "__uncategorized__" ? "Uncategorized" : row.name;
						const deltaPct = props.hasCompare
							? percentDelta(row.amount, row.previousAmount)
							: null;
						return (
							<li key={row.name} className="space-y-1">
								<div className="flex items-baseline justify-between gap-3 text-[12px]">
									<span className="truncate text-gray-12">{displayName}</span>
									<span className="num shrink-0 text-gray-12">
										{props.fAmount(row.amount, props.reportingCurrency)}
									</span>
								</div>
								<div className="relative h-1 overflow-hidden rounded-full bg-gray-a2">
									<div
										className="absolute inset-y-0 left-0 rounded-full bg-gray-a8"
										style={{ width: `${(row.amount / max) * 100}%` }}
									/>
								</div>
								{deltaPct != null && (
									<div className="text-[10px] text-gray-10">
										<DeltaBadge value={deltaPct} inverted /> vs prev
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function CounterpartyList(props: {
	rows: Array<CounterpartyRow & { isNew: boolean }>;
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
	hasCompare: boolean;
}) {
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<h2 className="text-[13px] font-medium text-gray-12">Top counterparties</h2>
				<span className="text-[11px] text-gray-10">By expense</span>
			</header>
			{props.rows.length === 0 ? (
				<EmptyHint>No expenses in this period.</EmptyHint>
			) : (
				<ul className="divide-y divide-gray-a3">
					{props.rows.map((row) => (
						<li
							key={row.name}
							className="flex items-center justify-between gap-3 py-2 text-[12px]"
						>
							<div className="flex min-w-0 items-center gap-2">
								<span className="truncate text-gray-12">{row.name}</span>
								{props.hasCompare && row.isNew && (
									<span className="rounded-sm bg-gray-a3 px-1 text-[10px] uppercase tracking-wider text-gray-11">
										new
									</span>
								)}
							</div>
							<div className="flex shrink-0 items-baseline gap-3">
								<span className="text-[11px] text-gray-10 num">×{row.count}</span>
								<span className="num text-gray-12">
									{props.fAmount(row.amount, props.reportingCurrency)}
								</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function CurrencyMix(props: {
	rows: CurrencyRow[];
	reportingCurrency: string;
	fAmount: (amount: number, currency: string) => string;
}) {
	if (props.rows.length === 0) return null;
	return (
		<section className="surface surface-bleed px-3 sm:px-4 py-5">
			<header className="mb-4 flex items-end justify-between">
				<h2 className="text-[13px] font-medium text-gray-12">Currency exposure</h2>
				<span className="text-[11px] text-gray-10">
					Non-{props.reportingCurrency} expense, converted
				</span>
			</header>
			<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{props.rows.map((row) => (
					<li
						key={row.currency}
						className="rounded-md border border-gray-a3 p-3"
					>
						<div className="text-[10px] uppercase tracking-[0.06em] text-gray-10 font-medium">
							{row.currency}
						</div>
						<div className="mt-1 text-[15px] font-medium num text-gray-12">
							{props.fAmount(row.amount, props.reportingCurrency)}
						</div>
						<div className="text-[11px] text-gray-10 num">×{row.count} tx</div>
					</li>
				))}
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
