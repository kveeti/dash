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

// prettier-ignore
const colors = [
	"#b4d1b7", "#a88c6f", "#3e8e7e", "#93d05f", "#7c466d",
	"#5a4b2e", "#b8cfcf", "#ed817d", "#8a9b66", "#d1f1ea",
	"#b0d84d", "#ca5e8a", "#5c3e7a", "#617ecf", "#df2d5d",
	"#57c9d9", "#b363bb", "#edc463", "#18f4f5", "#7a5929",
	"#8f6c8b", "#3f4981", "#659e5c", "#4dbda4", "#e02e1f",
	"#6b925b", "#c97b58", "#2fdb34", "#89a7de", "#aa6147",
	"#5b369e", "#fe6c4e", "#2acfd1", "#c5b2b5", "#c7f49f",
	"#755494", "#d4798b", "#e5c7c0", "#378986", "#cbe4cc",
	"#b08bb1", "#1e563a", "#d08559", "#7eae6b", "#ff5e3a",
	"#f3c9af", "#b3c28f", "#7bc9d0", "#db5b1a", "#d7b3e3"
];

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
	const domain_start = Math.round(q.data.domain_start - q.data.domain_start * -0.02);
	const domain_end = Math.round(q.data.domain_end + q.data.domain_end * 0.02);
	const ticks = [
		domain_start,
		Math.round(domain_start / 2),
		0,
		Math.round(domain_end / 2),
		domain_end,
	];

	function color(i: number) {
		const index = i % colors.length;
		return colors[index];
	}

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
						unit="−"
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
						domain={[domain_start, domain_end]}
						ticks={ticks}
					/>

					<Tooltip isAnimationActive={false} content={StackTooltip} />

					{categories.map((c, i) => (
						<Bar isAnimationActive={false} dataKey={c} stackId="a" fill={color(i)} />
					))}
				</BarChart>
			</ResponsiveContainer>
		</>
	);
}

function StackTooltip(props: any) {
	// TODO: this may not be ideal to call here
	// this component rerenders everytime mouse is moved
	// on top of a chart
	const { numberFormatter } = useFormatters();

	if (!props.label || !props.payload) return null;

	const label = format(props.label, "MMM yy");

	const pos = [];
	const neg = [];

	for (let i = 0; i < props.payload.length; i++) {
		const p = props.payload[i];
		const data = { name: p.name, value: p.value, color: p.color };
		if (p.value > 0) pos.push(data);
		else neg.push(data);
	}

	return (
		<div className="bg-gray-1 border-gray-4 border shadow-lg">
			<p className="border-b-gray-3 border-b p-2 leading-none font-medium">{label}</p>

			<ul className="border-gray-4 space-y-1.5 border-b p-2">
				{pos.map((p) => (
					<li key={p.name} className="flex items-center justify-between gap-4">
						<div className="flex items-center">
							<div style={{ backgroundColor: p.color }} className="me-2 size-3"></div>
							<span className="leading-none">
								{p.name === "__uncategorized__" ? "uncategorized" : p.name}
							</span>
						</div>
						<span className="leading-none">{numberFormatter.format(p.value)}</span>
					</li>
				))}
			</ul>

			<ul className="border-gray-4 space-y-1.5 p-2">
				{neg.map((p) => (
					<li key={p.name} className="flex items-center justify-between gap-4">
						<div className="flex items-center">
							<div style={{ backgroundColor: p.color }} className="me-2 size-3"></div>
							<span className="leading-none">
								{p.name === "__uncategorized__" ? "uncategorized" : p.name}
							</span>
						</div>
						<span className="leading-none">{numberFormatter.format(p.value)}</span>
					</li>
				))}
			</ul>
		</div>
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
									<span className="leading-none">{p.name}</span>
								</div>
								<span className="leading-none">
									{p.unit}
									{numberFormatter.format(p.value)}
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
