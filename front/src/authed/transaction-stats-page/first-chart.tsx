import * as d3 from "d3";
import { format } from "date-fns";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useMe } from "../../lib/me";
import { trpc } from "../../lib/trpc";
import { Spinner } from "../../ui/spinner";
import { CHART_SYNC_ID } from "./transaction-stats-page";

type Props = {
	timezone: string;
	timeframe: {
		start: Date;
		end: Date;
	};
};

const CHART_HEIGHT = 450;

export function FirstChart(props: Props) {
	const { numberFormatter } = useFormatters();

	const q = trpc.v1.transactions.stats.useQuery({
		timezone: props.timezone,
		start: props.timeframe.start,
		end: props.timeframe.end,
	});

	if (q.error) {
		<p>error</p>;
	}

	if (q.isPending) {
		return (
			<div
				style={{ height: CHART_HEIGHT }}
				className="text-gray-11 border-gray-5 flex w-full items-center justify-center border border-dashed"
			>
				<Spinner />
			</div>
		);
	}

	if (!q.data) throw new Error("no data");

	if (q.data.totalPos === 0 && q.data.totalNeg === 0) {
		return (
			<div
				style={{ height: CHART_HEIGHT }}
				className="text-gray-11 border-gray-5 flex w-full items-center justify-center border border-dashed"
			>
				no data
			</div>
		);
	}

	const { data, categories } = q.data;

	const color = d3.scaleSequential(d3.interpolateInferno).domain([0, categories.length]);

	return (
		<>
			{/* income & expenses */}
			<ResponsiveContainer width="100%" height={250}>
				<BarChart syncId={CHART_SYNC_ID} data={data}>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="currentColor"
						className="text-gray-7"
					/>
					<XAxis
						dataKey="__period__"
						stroke="currentColor"
						className="text-gray-10 text-xs"
						tickFormatter={(date) => format(date, "MMM yy")}
					/>
					<YAxis
						stroke="currentColor"
						className="text-gray-11 text-xs"
						tickFormatter={(value) => numberFormatter.format(value)}
					/>

					<Tooltip isAnimationActive={false} content={TooltipContent} />

					<Bar
						isAnimationActive={false}
						name="expenses"
						dataKey="__total_neg__"
						fill="#000"
					/>
					<Bar
						isAnimationActive={false}
						name="income"
						dataKey="__total_pos__"
						fill="hsla(131, 38%, 56%, 1)"
					/>
				</BarChart>
			</ResponsiveContainer>

			<ResponsiveContainer width="100%" height={550}>
				<BarChart syncId={CHART_SYNC_ID} data={data} stackOffset="sign">
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="currentColor"
						className="text-gray-7"
					/>
					<XAxis
						dataKey="__period__"
						stroke="currentColor"
						className="text-gray-10 text-xs"
						tickFormatter={(date) => format(date, "MMM yy")}
					/>
					<YAxis
						stroke="currentColor"
						className="text-gray-11 text-xs"
						tickFormatter={(value) => numberFormatter.format(value)}
					/>

					<Tooltip isAnimationActive={false} content={TooltipContent} />

					{categories.map((c, i) => (
						<Bar isAnimationActive={false} dataKey={c} stackId="a" fill={color(i)} />
					))}
				</BarChart>
			</ResponsiveContainer>
		</>
	);
}

function TooltipContent(props: any) {
	// TODO: this may not be ideal to call here
	// this component rerenders everytime mouse is moved
	// on top of a chart
	const { numberFormatter } = useFormatters();

	if (!props.label || !props.payload) return null;

	const label = format(props.label, "MMM yy");

	return (
		<div className="bg-gray-1 border-gray-4 border shadow-lg">
			<p className="border-b-gray-3 border-b p-2 leading-none font-medium">{label}</p>

			{props.payload.length && (
				<>
					<ul className="border-gray-4 space-y-1.5 border-b p-2">
						{props.payload.map((p) => (
							<li key={p.dataKey} className="flex items-center justify-between gap-4">
								<div className="flex items-center">
									<div
										style={{ backgroundColor: p.color }}
										className="me-2 size-3"
									></div>
									<span className="leading-none">
										{p.name === "__uncategorized__" ? "uncategorized" : p.name}
									</span>
								</div>
								<span className="leading-none">
									{numberFormatter.format(p.value as number)}
								</span>
							</li>
						))}
					</ul>

					{props.payload.length > 1 && (
						<div className="flex items-center justify-end gap-4 p-2">
							<span className="leading-none">
								{numberFormatter.format(props.payload[0].payload.__total__)}
							</span>
						</div>
					)}
				</>
			)}
		</div>
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
