import { endOfDay, format, startOfMonth, subYears } from "date-fns";
import { type ChangeEvent, startTransition } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocation, useSearch } from "wouter";

import { type ApiRes, trpc } from "../../lib/trpc";
import { Input } from "../../ui/input";

export function TransactionStatsPage() {
	const [location, navigate] = useLocation();
	const searchParams = new URLSearchParams(useSearch());
	const pStart = searchParams.get("start");
	const pEnd = searchParams.get("end");

	const now = new Date();

	const timeframe = {
		start: pStart ? new Date(pStart) : startOfMonth(subYears(now, 2)),
		end: pEnd ? new Date(pEnd) : endOfDay(now),
	};

	const startDate = format(timeframe.start, "yyyy-MM-dd");
	const startTime = format(timeframe.start, "HH:ss");

	const endDate = format(timeframe.end, "yyyy-MM-dd");
	const endTime = format(timeframe.end, "HH:ss");

	function onTimeframeChange(
		this: "start" | "end",
		valueType: "date" | "time",
		event: ChangeEvent<HTMLInputElement>
	) {
		const input = this;
		const newValue = event.target.valueAsDate;
		if (!newValue) return;

		const value = timeframe[input];
		if (valueType === "date") {
			value.setUTCDate(newValue.getUTCDate());
			value.setUTCFullYear(newValue.getUTCFullYear());
			value.setUTCMonth(newValue.getUTCMonth());
		} else {
			value.setUTCHours(newValue.getUTCHours());
			value.setUTCMinutes(newValue.getUTCMinutes());
		}

		const newSearchParams = new URLSearchParams(searchParams);
		newSearchParams.set(input, value.toISOString());

		startTransition(() => {
			navigate(location + "?" + newSearchParams.toString(), { replace: true });
		});
	}

	return (
		<div className="h-full w-full">
			<div className="mx-5 mb-5 flex items-center">
				<div className="flex w-full gap-2">
					<Input
						type="date"
						defaultValue={startDate}
						onChange={onTimeframeChange.bind("start", "date")}
					/>
					<div className="w-max">
						<Input
							type="time"
							defaultValue={startTime}
							onChange={onTimeframeChange.bind("start", "time")}
						/>
					</div>
				</div>
				<span className="ms-4 me-4">-</span>
				<div className="flex w-full gap-2">
					<Input
						type="date"
						defaultValue={endDate}
						onChange={onTimeframeChange.bind("end", "date")}
					/>
					<div className="w-max">
						<Input
							type="time"
							defaultValue={endTime}
							onChange={onTimeframeChange.bind("end", "time")}
						/>
					</div>
				</div>
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
		return <div>loading...</div>;
	}

	if (!q.data) throw new Error("no data");

	return <Chart data={q.data} />;
}

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
		<ResponsiveContainer width={"100%"} height={350}>
			<BarChart data={stats} stackOffset="sign">
				<CartesianGrid
					strokeDasharray="3 3"
					stroke="currentColor"
					className="text-gray-6"
				/>
				<XAxis dataKey="period" tickFormatter={(date) => format(date, "MMM yy")} />
				<YAxis
					domain={[
						(dataMin: number) => {
							const nearest = Math.round(dataMin / 1000) * 1000;
							return Math.min(nearest - 1000, 3000);
						},
						(dataMax: number) => {
							const nearest = Math.round(dataMax / 1000) * 1000;
							return Math.max(nearest + 1000, 3000);
						},
					]}
				/>

				<Tooltip
					isAnimationActive={false}
					cursor={false}
					content={(props) => {
						if (!props.label || !props.payload) return null;
						const label = format(props.label, "MMM yy");
						const things = [...props.payload]; // TODO: dont like this

						const pos = [];
						const neg = [];

						for (let i = 0; i < things.length; i++) {
							const thing = things[i];
							if (typeof thing?.value !== "number") continue;

							if (thing.value > 0) pos.push(thing);
							else neg.push(thing);
						}

						return (
							<div className="bg-gray-4/50 p-2 backdrop-blur-sm">
								<p className="mb-1 font-medium">{label}</p>
								<ul className="mb-1.5">
									{pos.map((p) => {
										return (
											<li className="flex items-center justify-between gap-4">
												<div className="flex items-center">
													<div
														style={{ backgroundColor: p.color }}
														className="me-2 size-3"
													></div>
													<span className="me-2 text-sm">
														{p.dataKey}
													</span>
												</div>
												<span className="text-sm">
													{Math.round(p.value as number)} €
												</span>
											</li>
										);
									})}
								</ul>
								<ul>
									{neg.map((p) => {
										return (
											<li className="flex items-center justify-between gap-2">
												<div className="flex items-center">
													<div
														style={{ backgroundColor: p.color }}
														className="me-2 size-3"
													></div>
													<span className="me-2 text-sm">
														{p.dataKey}
													</span>
												</div>
												<span className="text-sm">
													{Math.round(p.value as number)} €
												</span>
											</li>
										);
									})}
								</ul>
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
