import { useState } from "react";
import { useStatsQuery, type StatRow } from "../../lib/queries/stats";
import { useI18n } from "../../providers";

function getDefaultRange(): [string, string] {
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth();
	const from = new Date(y, m - 5, 1).toISOString().slice(0, 10);
	const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
	return [from, to];
}

export function StatsPage() {
	const [defaults] = useState(getDefaultRange);
	const [from, setFrom] = useState(defaults[0]);
	const [to, setTo] = useState(defaults[1]);

	const query = useStatsQuery(from, to);

	return (
		<div className="w-full mx-auto max-w-[600px] mt-14 px-4">
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
			{query.data && <StatsTable rows={query.data} />}
		</div>
	);
}

function StatsTable({ rows }: { rows: StatRow[] }) {
	const { f } = useI18n();
	if (rows.length === 0) {
		return <p className="text-sm text-gray-10">no data for this range</p>;
	}

	const bucketLabel: Record<string, string> = {
		i: "income",
		e: "expense",
		n: "neutral",
	};

	return (
		<table className="w-full text-sm font-mono">
			<thead>
				<tr className="border-b border-gray-a4 text-left text-xs text-gray-10">
					<th className="py-1 pr-3">period</th>
					<th className="py-1 pr-3">type</th>
					<th className="py-1 pr-3">category</th>
					<th className="py-1 text-right">amount</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row, i) => (
					<tr key={i} className="border-b border-gray-a3">
						<td className="py-1 pr-3">{row.period}</td>
						<td className="py-1 pr-3">
							{bucketLabel[row.bucket] ?? row.bucket}
						</td>
						<td className="py-1 pr-3">{row.cat_name}</td>
						<td className="py-1 text-right">{f.amount.format(row.amount)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
