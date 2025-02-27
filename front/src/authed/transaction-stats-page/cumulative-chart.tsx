import { format } from "date-fns";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

export function CumulativeChart(props: Props) {
	return (
		<div>
			<h2 className="mb-4 text-xl">cumulative balance</h2>

			<Chart {...props} />
		</div>
	);
}

function Chart(props: Props) {
	const { numberFormatter } = useFormatters();

	const q = trpc.v1.transactions.statsCumulative.useQuery({
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
			<AreaChart syncId={CHART_SYNC_ID} data={data}>
				<Tooltip
					isAnimationActive={false}
					cursor={false}
					content={({ payload }) => {
						const data = payload?.[0]?.payload;
						if (!data) return null;

						const label = format(data.date, "MMM yy");
						const value = numberFormatter.format(data.value);

						return (
							<div className="bg-gray-1 border-gray-4 min-w-22 border shadow-lg">
								<p className="border-b-gray-4 border-b p-2 leading-none font-medium">
									{label}
								</p>
								<p className="p-2 leading-none">{value}</p>
							</div>
						);
					}}
				/>
				<defs>
					<linearGradient id="value" x1="0" y1="0" x2="0" y2="1">
						<stop offset="2%" stopColor="var(--gray-9)" stopOpacity={0.8} />
						<stop offset="95%" stopColor="var(--gray-9)" stopOpacity={0.0} />
					</linearGradient>
				</defs>
				<Area
					isAnimationActive={false}
					dataKey="value"
					type="natural"
					fill="url(#value)"
					fillOpacity={0.4}
					stroke="var(--gray-9)"
				/>
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={false}
					className="text-gray-10 text-xs"
					tickFormatter={(date) => format(date, "MMM yy")}
				/>
				<YAxis
					tickFormatter={(value) => numberFormatter.format(value)}
					stroke="currentColor"
					className="text-gray-10 text-xs"
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

function useFormatters() {
	const { me } = useMe();
	const locale = me?.preferences?.locale ?? "en-US";

	const numberFormatter = useMemo(
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

	return { numberFormatter };
}
