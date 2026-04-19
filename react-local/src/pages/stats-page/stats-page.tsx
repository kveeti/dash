import { useEffect, useMemo, useState } from "react";
import {
	useConvertedStatTransactionsQuery,
	useConvertedStatsSummaryQuery,
	useStatsQuery,
	type ConvertedStatTransactionRow,
	type ConvertedStatsSummary,
	type StatRow,
} from "../../lib/queries/stats";
import { useI18n } from "../../providers";
import { useAppSettingsQuery } from "../../lib/queries/settings";

function getDefaultRange(): [string, string] {
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth();
	const from = new Date(y, m - 5, 1).toISOString().slice(0, 10);
	const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
	return [from, to];
}

type MonthSummary = {
	period: string;
	income: number;
	expense: number;
	neutral: number;
	txCount: number;
	unconvertedCount: number;
};

export function StatsPage() {
	const [defaults] = useState(getDefaultRange);
	const [from, setFrom] = useState(defaults[0]);
	const [to, setTo] = useState(defaults[1]);
	const settings = useAppSettingsQuery();

	const query = useStatsQuery({
		from,
		to,
		reportingCurrency: settings.data?.reporting_currency,
		maxStalenessDays: settings.data?.max_staleness_days,
		mode: settings.data?.conversion_mode,
	});
	const convertedSummary = useConvertedStatsSummaryQuery({
		from,
		to,
		reportingCurrency: settings.data?.reporting_currency,
		maxStalenessDays: settings.data?.max_staleness_days,
		mode: settings.data?.conversion_mode,
	});
	const convertedTransactions = useConvertedStatTransactionsQuery({
		from,
		to,
		reportingCurrency: settings.data?.reporting_currency,
		maxStalenessDays: settings.data?.max_staleness_days,
		mode: settings.data?.conversion_mode,
	});

	const reportingCurrency =
		convertedSummary.data?.reporting_currency ||
		settings.data?.reporting_currency ||
		"EUR";

	return (
		<div className="w-full mx-auto max-w-[1080px] mt-14 px-4">
			<h1 className="text-lg mb-4">stats</h1>

			<div className="flex gap-3 mb-4">
				<input
					type="date"
					value={from}
					onChange={(e) => setFrom(e.target.value)}
					className="border border-gray-a4 bg-gray-1 px-2 py-1 text-sm font-mono"
				/>
				<input
					type="date"
					value={to}
					onChange={(e) => setTo(e.target.value)}
					className="border border-gray-a4 bg-gray-1 px-2 py-1 text-sm font-mono"
				/>
			</div>

			{query.isLoading && <p className="text-sm text-gray-10">loading...</p>}
			{query.isError && (
				<pre className="text-sm text-red-11 whitespace-pre-wrap">
					{String(query.error)}
				</pre>
			)}

			{query.data && (
				<DesktopMonthExplorer
					rows={query.data}
					transactions={convertedTransactions.data ?? []}
					reportingCurrency={reportingCurrency}
				/>
			)}

			{convertedSummary.data && (
				<ConvertedSummaryCard
					className="mt-4"
					summary={convertedSummary.data}
				/>
			)}
		</div>
	);
}

function ConvertedSummaryCard({
	summary,
	className
}: {
	summary: ConvertedStatsSummary;
	className?: string
}) {
	const { f } = useI18n();
	if (!summary) return null;

	const coverageCount = (summary.coverage_count_ratio * 100).toFixed(1);
	const coverageAmount = (summary.coverage_amount_ratio * 100).toFixed(1);
	const isPartial = summary.converted_count < summary.total_count;

	return (
		<div className={"border border-gray-a4 p-3 text-xs space-y-1 " + className}>
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

function DesktopMonthExplorer({
	rows,
	transactions,
	reportingCurrency,
}: {
	rows: StatRow[];
	transactions: ConvertedStatTransactionRow[];
	reportingCurrency: string;
}) {
	const { f } = useI18n();
	const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

	const months = useMemo<MonthSummary[]>(() => {
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
	}, [rows]);

	useEffect(() => {
		if (months.length === 0) {
			setSelectedPeriod(null);
			return;
		}
		if (!selectedPeriod || !months.some((month) => month.period === selectedPeriod)) {
			setSelectedPeriod(months[0].period);
		}
	}, [months, selectedPeriod]);

	const detailRows = useMemo(
		() =>
			rows
				.filter((row) => row.period === selectedPeriod)
				.sort((a, b) => a.bucket.localeCompare(b.bucket) || b.amount - a.amount),
		[rows, selectedPeriod],
	);
	const detailTransactions = useMemo(
		() => transactions.filter((row) => row.period === selectedPeriod),
		[transactions, selectedPeriod],
	);

	if (rows.length === 0) {
		return <p className="text-sm text-gray-10">no data for this range</p>;
	}

	return (
		<>
			<div className="md:hidden text-xs text-gray-10 border border-gray-a4 p-3">
				Desktop month explorer is available on wider screens.
			</div>
			<div className="hidden md:grid md:grid-cols-[20rem_minmax(0,1fr)] gap-4">
				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						months
					</div>
					<div className="max-h-[72dvh] overflow-auto p-2 space-y-2">
						{months.map((month) => {
							const isSelected = month.period === selectedPeriod;
							return (
								<button
									key={month.period}
									type="button"
									onMouseEnter={() => setSelectedPeriod(month.period)}
									onFocus={() => setSelectedPeriod(month.period)}
									onClick={() => setSelectedPeriod(month.period)}
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
					</div>
				</div>
			</div>
		</>
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
									const originalAmount = Math.abs(tx.original_signed_amount);
									const isConverted =
										convertedAmount != null &&
										tx.original_currency !== reportingCurrency;
									return (
										<div
											key={tx.id}
											className="flex items-center justify-between pl-2 text-[11px]"
										>
											<span className="text-gray-10">{tx.eff_date}</span>
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
