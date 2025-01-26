import { endOfDay, format, isAfter, isBefore, startOfMonth, startOfYear, subYears } from "date-fns";
import { type ChangeEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocation, useSearch } from "wouter";

import { type ApiRes, trpc } from "../../lib/trpc";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";

const CHART_HEIGHT = 450;

export default function TransactionStatsPage() {
	const [location, navigate] = useLocation();
	const searchParams = new URLSearchParams(useSearch());

	const pStart = searchParams.get("start");
	const pEnd = searchParams.get("end");

	const now = new Date();

	const max = endOfDay(now);
	const f_date_max = format(max, "yyyy-MM-dd");

	const min = subYears(startOfYear(now), 10);
	const f_date_min = format(min, "yyyy-MM-dd");

	const timeframe = {
		start: pStart ? new Date(pStart) : startOfMonth(subYears(now, 2)),
		end: pEnd ? new Date(pEnd) : max,
	};

	const startDate = format(timeframe.start, "yyyy-MM-dd");

	const endDate = format(timeframe.end, "yyyy-MM-dd");

	function onTimeframeChange(input: "start" | "end", event: ChangeEvent<HTMLInputElement>) {
		const newValue = event.target.valueAsDate;
		if (!newValue) return;

		const value = timeframe[input];
		value.setUTCDate(newValue.getUTCDate());
		value.setUTCFullYear(newValue.getUTCFullYear());
		value.setUTCMonth(newValue.getUTCMonth());
		if (input === "start") {
			value.setUTCHours(0, 0, 0, 0);
		} else if (input === "end") {
			value.setUTCHours(23, 59, 59, 999);
		}

		if (isBefore(value, min) || isAfter(value, max)) {
			return;
		}

		const newSearchParams = new URLSearchParams(searchParams);
		newSearchParams.set(input, value.toISOString());

		navigate(location + "?" + newSearchParams.toString());
	}

	return (
		<div className="h-full w-full px-2">
			<div className="mx-5 mb-5 flex flex-col items-center gap-2 sm:flex-row">
				<Input
					type="date"
					min={f_date_min}
					max={f_date_max}
					defaultValue={startDate}
					onChange={(e) => onTimeframeChange("start", e)}
					className="p-2"
				/>
				<span className="text-gray-11 hidden sm:inline">-</span>
				<Input
					type="date"
					min={f_date_min}
					max={f_date_max}
					defaultValue={endDate}
					onChange={(e) => onTimeframeChange("end", e)}
				/>
			</div>
			<ChartWrapper timeframe={timeframe} />
		</div>
	);
}

function ChartWrapper({ timeframe }: { timeframe: { start: Date; end: Date } }) {
	const q = trpc.v1.transactions.stats.useQuery({
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		start: timeframe.start,
		end: timeframe.end,
		frequency: "monthly",
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

	return <Chart data={q.data} />;
}

const numberFormatter = new Intl.NumberFormat("fi-FI", {
	signDisplay: "auto",
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
	currencyDisplay: "symbol",
	style: "currency",
	currency: "EUR",
});

function Chart(props: { data: ApiRes["v1"]["transactions"]["stats"] }) {
	const { posCategories, negCategories, stats } = props.data;

	const colorsNegCategories = negCategories.map((_, i) => {
		const hue = ((i + 0.9) * 360) / negCategories.length;
		const lightness = i % 2 === 0 ? 40 : 60;
		const saturation = 70;
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	});

	const colorsPosCategories = posCategories.map((_, i) => {
		const hue = (i - 0.1 * 360) / posCategories.length;
		const lightness = i % 2 === 0 ? 60 : 40;
		const saturation = 70;
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	});

	return (
		<ResponsiveContainer width={"100%"} height={CHART_HEIGHT}>
			<BarChart data={stats} stackOffset="sign">
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

				<Tooltip
					allowEscapeViewBox={{ x: true, y: true }}
					isAnimationActive={false}
					cursor={false}
					content={(props) => {
						if (!props.label || !props.payload) return null;
						const label = format(props.label, "MMM yy");

						const pos = [];
						const neg = [];

						let total = 0;

						for (let i = 0; i < props.payload.length; i++) {
							const thing = props.payload[i];
							if (typeof thing?.value !== "number") continue;

							total += thing.value;

							if (thing.value > 0) pos.push(thing);
							else neg.push(thing);
						}

						return (
							<div className="bg-gray-1 border-gray-4 border p-2 shadow-lg">
								<p className="mb-3 leading-none font-medium">{label}</p>
								{!!pos.length && (
									<>
										<ul className="space-y-1.5">
											{pos.map((p) => {
												return (
													<li className="flex items-center justify-between gap-4">
														<div className="flex items-center">
															<div
																style={{ backgroundColor: p.color }}
																className="me-2 size-3"
															></div>
															<span className="leading-none">
																{p.dataKey === "__uncategorized__"
																	? "uncategorized"
																	: p.dataKey}
															</span>
														</div>
														<span className="leading-none">
															{numberFormatter.format(
																p.value as number
															)}
														</span>
													</li>
												);
											})}
										</ul>
									</>
								)}

								{!!neg.length && (
									<>
										<hr className="border-gray-4 -mx-2 my-2 border-t" />

										<ul className="space-y-1.5">
											{neg.map((p) => {
												return (
													<li className="flex items-center justify-between gap-4">
														<div className="flex items-center">
															<div
																style={{ backgroundColor: p.color }}
																className="me-2 size-3"
															></div>
															<span className="leading-none">
																{p.dataKey === "__uncategorized__"
																	? "uncategorized"
																	: p.dataKey}
															</span>
														</div>
														<span className="leading-none">
															{numberFormatter.format(
																p.value as number
															)}
														</span>
													</li>
												);
											})}
										</ul>
									</>
								)}

								<hr className="border-gray-4 -mx-2 my-2 border-t" />
								<div className="flex justify-end leading-none">
									<span>{numberFormatter.format(total as number)}</span>
								</div>
							</div>
						);
					}}
				/>
				{negCategories.map((p, i) => (
					<Bar
						key={p}
						dataKey={p}
						stackId="a"
						fill={colorsNegCategories[i]}
						isAnimationActive={false}
					/>
				))}

				{posCategories.map((p, i) => (
					<Bar
						key={p}
						dataKey={p}
						stackId="a"
						fill={colorsPosCategories[i]}
						isAnimationActive={false}
					/>
				))}
			</BarChart>
		</ResponsiveContainer>
	);
}
