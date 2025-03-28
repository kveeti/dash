import { format } from "date-fns";
import { useMemo } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { useMe } from "../../lib/me";
import { trpc } from "../../lib/trpc";
import { CHART_SYNC_ID } from "./transaction-stats-page";

type Props = {
	timezone: string;
	timeframe: {
		start: Date;
		end: Date;
	};
};

export function CountAndAverageChart(props: Props) {
	return (
		<div>
			<h2 className="mb-4 text-xl">chart2</h2>

			<Chart {...props} />
		</div>
	);
}

function Chart(props: Props) {
	const { amountFormatter } = useFormatters();

	const q = trpc.v1.transactions.statsCountAndAverage.useQuery({
		timezone: props.timezone,
		start: props.timeframe.start,
		end: props.timeframe.end,
	});

	if (q.error) {
		return <div>Error: {q.error.message}</div>;
	}

	if (q.isLoading) {
		return <div>Loading...</div>;
	}

	const data = q.data;

	return (
		<ResponsiveContainer width="100%" height={200}>
			<BarChart syncId={CHART_SYNC_ID} data={data}>
				<CartesianGrid
					strokeDasharray="3 3"
					stroke="currentColor"
					className="text-gray-7"
				/>
				<XAxis
					dataKey="date"
					stroke="currentColor"
					className="text-gray-10 text-xs"
					tickFormatter={(date) => format(date, "MMM yy")}
				/>
				<YAxis
					yAxisId="left"
					stroke="currentColor"
					className="text-gray-11 text-xs"
					tickFormatter={(value) => amountFormatter.format(value)}
				/>
				<YAxis
					yAxisId="right"
					orientation="right"
					stroke="currentColor"
					className="text-gray-11 text-xs"
				/>

				<Tooltip
					isAnimationActive={false}
					content={(props) => {
						if (!props.active) return null;

						const label = format(props.label, "MMM yy");

						return (
							<div className="bg-gray-1 border-gray-4 min-w-26 border shadow-lg">
								<p className="border-b-gray-4 border-b p-2 leading-none font-medium">
									{label}
								</p>

								{props.payload?.map((d) => {
									const color = d.color;
									const name = d.name;
									const value =
										name === "avg"
											? amountFormatter.format(d.value as number)
											: d.value;

									return (
										<div
											key={name}
											className="flex items-center justify-between gap-4 p-2 leading-none"
										>
											<div className="flex items-center gap-2">
												<div
													className="size-3"
													style={{ backgroundColor: color }}
												></div>
												<span>{d.name}</span>
											</div>

											<span>{value}</span>
										</div>
									);
								})}
							</div>
						);
					}}
				/>

				<Bar
					isAnimationActive={false}
					dataKey="count"
					fill="#8884d8"
					yAxisId="right"
					name="# of tx"
				/>
				<Bar
					isAnimationActive={false}
					dataKey="avg"
					fill="#82ca9d"
					yAxisId="left"
					name="avg"
				/>
			</BarChart>
		</ResponsiveContainer>
	);
}

function useFormatters() {
	const { me } = useMe();
	const locale = me?.preferences?.locale ?? "en-US";

	const amountFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				signDisplay: "auto",
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
				currencyDisplay: "symbol",
				style: "currency",
				currency: "EUR",
			}),
		[locale]
	);

	return { amountFormatter };
}
