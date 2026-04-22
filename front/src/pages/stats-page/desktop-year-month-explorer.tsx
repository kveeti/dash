import { useMemo, useState } from "react";
import {
	type ConvertedStatTransactionRow,
	type ConvertedStatsSummary,
	type MonthStatRow,
	type StatRow,
	type TransactionYearRow,
	useConvertedStatTransactionsQuery,
	useConvertedStatsSummaryQuery,
	useMonthStatsQuery,
	useStatsQuery,
} from "../../lib/queries/stats";
import { useI18n } from "../../providers";

function getYearBounds(year: number): [string, string] {
	const y = String(year);
	return [`${y}-01-01`, `${y}-12-31`];
}

function getMonthBounds(period: string): [string, string] {
	const [yearStr, monthStr] = period.split("-");
	const year = Number(yearStr);
	const month = Number(monthStr);
	const from = `${period}-01`;
	const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
	return [from, to];
}

type YearSummary = {
	year: number;
	txCount: number;
};

type MonthSummary = {
	period: string;
	income: number;
	expense: number;
	neutral: number;
	txCount: number;
	unconvertedCount: number;
};

function summarizeYears(rows: TransactionYearRow[]): YearSummary[] {
	const map = new Map<number, YearSummary>();
	for (const row of rows) {
		const year = Number(row.year);
		if (!Number.isFinite(year)) continue;
		map.set(year, {
			year,
			txCount: Number(row.tx_count || 0),
		});
	}
	return [...map.values()].sort((a, b) => b.year - a.year);
}

function summarizeMonths(rows: MonthStatRow[]): MonthSummary[] {
	const map = new Map<string, MonthSummary>();
	for (const row of rows) {
		const existing = map.get(row.period) ?? {
			period: row.period,
			income: 0,
			expense: 0,
			neutral: 0,
			txCount: 0,
			unconvertedCount: 0,
		};
		if (row.bucket === "i") existing.income += row.amount;
		else if (row.bucket === "e") existing.expense += row.amount;
		else existing.neutral += row.amount;
		existing.txCount += row.tx_count;
		existing.unconvertedCount += row.unconverted_count;
		map.set(row.period, existing);
	}
	return [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
}

export function DesktopYearMonthExplorer({
	yearRows,
	reportingCurrency,
	queryReportingCurrency,
	mode,
	maxStalenessDays,
}: {
	yearRows: TransactionYearRow[];
	reportingCurrency: string;
	queryReportingCurrency?: string;
	mode: "strict" | "lenient";
	maxStalenessDays: number;
}) {
	const { f } = useI18n();
	const now = useMemo(() => new Date(), []);
	const currentYear = now.getFullYear();
	const currentPeriod = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;

	const years = useMemo(() => summarizeYears(yearRows), [yearRows]);

	const [yearSelection, setYearSelection] = useState<number | null>(null);
	const selectedYear = useMemo(() => {
		if (years.length === 0) return null;
		if (yearSelection != null && years.some((y) => y.year === yearSelection)) {
			return yearSelection;
		}
		if (years.some((y) => y.year === currentYear)) {
			return currentYear;
		}
		return years[0].year;
	}, [years, yearSelection, currentYear]);

	const selectedYearRange = useMemo(
		() => (selectedYear == null ? null : getYearBounds(selectedYear)),
		[selectedYear],
	);

	const monthStats = useMonthStatsQuery({
		from: selectedYearRange?.[0] ?? "",
		to: selectedYearRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!selectedYearRange && !!queryReportingCurrency,
	});
	const months = useMemo(() => summarizeMonths(monthStats.data ?? []), [monthStats.data]);

	const [periodSelection, setPeriodSelection] = useState<string | null>(null);
	const selectedPeriod = useMemo(() => {
		if (months.length === 0) return null;
		if (periodSelection && months.some((month) => month.period === periodSelection)) {
			return periodSelection;
		}
		if (selectedYear === currentYear && months.some((month) => month.period === currentPeriod)) {
			return currentPeriod;
		}
		return months[0].period;
	}, [months, periodSelection, selectedYear, currentYear, currentPeriod]);

	const selectedMonthRange = useMemo(
		() => (selectedPeriod ? getMonthBounds(selectedPeriod) : null),
		[selectedPeriod],
	);

	const summaryQuery = useConvertedStatsSummaryQuery({
		from: selectedYearRange?.[0] ?? "",
		to: selectedYearRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!selectedYearRange && !!queryReportingCurrency,
	});

	const monthCategoryQuery = useStatsQuery({
		from: selectedMonthRange?.[0] ?? "",
		to: selectedMonthRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!selectedMonthRange && !!queryReportingCurrency,
	});
	const detailRows = useMemo(
		() =>
			(monthCategoryQuery.data ?? []).slice().sort(
				(a, b) => a.bucket.localeCompare(b.bucket) || b.amount - a.amount,
			),
		[monthCategoryQuery.data],
	);

	const detailTransactionsQuery = useConvertedStatTransactionsQuery({
		from: selectedMonthRange?.[0] ?? "",
		to: selectedMonthRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		perCategoryLimit: 12,
		enabled: !!selectedMonthRange && !!queryReportingCurrency,
	});
	const detailTransactions = detailTransactionsQuery.data ?? [];

	if (yearRows.length === 0) {
		return <p className="text-sm text-gray-10">no data</p>;
	}

	const isLoading = summaryQuery.isLoading || monthCategoryQuery.isLoading || detailTransactionsQuery.isLoading;

	return (
		<>
			<div className="md:hidden text-xs text-gray-10 border border-gray-a4 p-3">
				Year/month explorer is available on wider screens.
			</div>
			<div className="hidden md:grid md:grid-cols-[12rem_20rem_1fr] gap-4">
				<div className="border border-gray-a4 w-full">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						years
					</div>
					<div className="max-h-[72dvh] overflow-auto p-2 space-y-2">
						{years.map((year) => {
							const isSelected = year.year === selectedYear;
							return (
								<button
									key={year.year}
									type="button"
									onMouseEnter={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									onFocus={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									onClick={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									className={
										"w-full border px-3 py-2 text-left font-mono text-xs transition-colors " +
										(isSelected
											? "border-gray-8 bg-gray-a3"
											: "border-gray-a4 hover:bg-gray-a2")
									}
								>
									<div className="mb-1 text-sm text-gray-12">{year.year}</div>
									<div className="text-gray-10">{year.txCount} tx</div>
								</button>
							);
						})}
					</div>
				</div>

				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						months {selectedYear ?? ""}
					</div>
					<div className="max-h-[72dvh] overflow-auto p-2 space-y-2">
						{monthStats.isLoading && <p className="text-xs text-gray-10">loading months...</p>}
						{monthStats.isError && (
							<pre className="text-xs text-red-11 whitespace-pre-wrap">
								{String(monthStats.error)}
							</pre>
						)}
						{months.map((month) => {
							const isSelected = month.period === selectedPeriod;
							return (
								<button
									key={month.period}
									type="button"
									onMouseEnter={() => setPeriodSelection(month.period)}
									onFocus={() => setPeriodSelection(month.period)}
									onClick={() => setPeriodSelection(month.period)}
									className={
										"w-full border px-3 py-2 text-left font-mono text-xs transition-colors " +
										(isSelected
											? "border-gray-8 bg-gray-a3"
											: "border-gray-a4 hover:bg-gray-a2")
									}
								>
									<div className="mb-1 text-sm text-gray-12">{month.period}</div>
									<div className="text-gray-11">+ {f.amount(month.income, reportingCurrency)}</div>
									<div className="text-gray-11">- {f.amount(month.expense, reportingCurrency)}</div>
									<div className="text-gray-10">n {f.amount(month.neutral, reportingCurrency)}</div>
									{month.unconvertedCount > 0 && (
										<div className="mt-1 text-orange-11">
											{month.unconvertedCount} unconverted / {month.txCount} tx
										</div>
									)}
								</button>
							);
						})}
					</div>
				</div>

				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						{selectedPeriod ? `details ${selectedPeriod}` : "details"}
					</div>
					<div className="p-3 space-y-4">
						{isLoading ? <p className="text-xs text-gray-10">loading...</p> : (
							<>
								{summaryQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(summaryQuery.error)}
									</pre>
								)}
								{summaryQuery.data && (
									<ConvertedSummaryCard summary={summaryQuery.data} className="mb-4" />
								)}

								{monthCategoryQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(monthCategoryQuery.error)}
									</pre>
								)}
								{detailTransactionsQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(detailTransactionsQuery.error)}
									</pre>
								)}
								<BucketSection
									label="income"
									bucket="i"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
								<BucketSection
									label="expense"
									bucket="e"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
								<BucketSection
									label="neutral"
									bucket="n"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
							</>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

function ConvertedSummaryCard({
	summary,
	className,
}: {
	summary: ConvertedStatsSummary;
	className?: string;
}) {
	const { f } = useI18n();
	const coverageCount = (summary.coverage_count_ratio * 100).toFixed(1);
	const coverageAmount = (summary.coverage_amount_ratio * 100).toFixed(1);
	const isPartial = summary.converted_count < summary.total_count;

	return (
		<div className={"border border-gray-a4 p-3 text-xs space-y-1 " + (className ?? "") }>
			<p className="text-gray-10">
				reporting currency: <span className="text-gray-12">{summary.reporting_currency}</span>
				{" "}({summary.mode}, stale limit {summary.max_staleness_days}d)
			</p>
			<p className="text-sm">
				converted total:{" "}
				<strong>{f.amount(summary.converted_total, summary.reporting_currency)}</strong>
			</p>
			<p className={isPartial ? "text-orange-11" : "text-gray-10"}>
				coverage: {summary.converted_count}/{summary.total_count} tx ({coverageCount}%),
				amount coverage {coverageAmount}%
			</p>
			{summary.missing_by_currency.length > 0 && (
				<ul className="text-gray-10">
					{summary.missing_by_currency.slice(0, 5).map((row) => (
						<li key={row.currency}>
							missing {row.currency}: {row.count} tx, {f.amount(row.amount, row.currency)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function BucketSection({
	label,
	bucket,
	rows,
	transactions,
	reportingCurrency,
}: {
	label: string;
	bucket: "i" | "e" | "n";
	rows: StatRow[];
	transactions: ConvertedStatTransactionRow[];
	reportingCurrency: string;
}) {
	const { f } = useI18n();
	const bucketRows = rows.filter((row) => row.bucket === bucket);
	const bucketTransactions = transactions.filter((row) => row.bucket === bucket);
	if (bucketRows.length === 0) return null;

	const total = bucketRows.reduce((sum, row) => sum + row.amount, 0);
	const totalTx = bucketRows.reduce((sum, row) => sum + row.tx_count, 0);
	const unconverted = bucketRows.reduce((sum, row) => sum + row.unconverted_count, 0);

	return (
		<div>
			<div className="mb-2 flex items-center justify-between text-xs font-mono">
				<span className="text-gray-12">{label}</span>
				<span className="text-gray-10">
					{f.amount(total, reportingCurrency)} · {totalTx} tx
					{unconverted > 0 ? ` · ${unconverted} unconverted` : ""}
				</span>
			</div>
			<div className="border border-gray-a4">
				{bucketRows.map((row) => (
					<div
						key={`${row.period}_${row.bucket}_${row.cat_name}`}
						className="border-b border-gray-a3 px-2 py-1 text-xs font-mono last:border-b-0"
					>
						<div className="flex items-center justify-between">
							<div className="truncate pr-2">
								<span className="text-gray-12">{row.cat_name}</span>
								<span className="text-gray-10">{` · ${row.tx_count} tx`}</span>
								{row.unconverted_count > 0 && (
									<span className="text-orange-11">{` · ${row.unconverted_count} miss`}</span>
								)}
							</div>
							<span className="shrink-0">{f.amount(row.amount, reportingCurrency)}</span>
						</div>
						<div className="mt-1 space-y-1">
							{bucketTransactions
								.filter((tx) => tx.cat_name === row.cat_name)
								.slice(0, 12)
								.map((tx) => {
									const convertedAmount = tx.converted_amount;
									const originalAmount = tx.original_amount;
									const isConverted =
										convertedAmount != null &&
										tx.original_currency !== reportingCurrency;
									return (
										<div
											key={tx.id}
											className="flex items-center justify-between pl-2 text-[11px]"
										>
											<span className="text-gray-10">{tx.counter_party}</span>
											<span className="text-right">
												{convertedAmount == null ? (
													<span className="text-orange-11">
														missing rate ({f.amount(originalAmount, tx.original_currency)})
													</span>
												) : (
													<>
														<span>{f.amount(convertedAmount, reportingCurrency)}</span>
														{isConverted && (
															<span className="text-gray-10">
																{" "}
																from {f.amount(originalAmount, tx.original_currency)}
															</span>
														)}
													</>
												)}
											</span>
										</div>
									);
								})}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
