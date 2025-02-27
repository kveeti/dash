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
	return (
		<div>
			<h2 className="mb-4 text-xl">first chart</h2>

			<Chart {...props} />
		</div>
	);
}

function Chart(props: Props) {
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

	const { posCategories, negCategories, stats } = q.data;

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
			<BarChart syncId={CHART_SYNC_ID} data={stats} stackOffset="sign">
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
							<div className="bg-gray-1 border-gray-4 border shadow-lg">
								<p className="border-b-gray-3 border-b p-2 leading-none font-medium">
									{label}
								</p>

								{!!pos.length && (
									<ul className="border-gray-4 space-y-1.5 border-b p-2">
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
														{numberFormatter.format(p.value as number)}
													</span>
												</li>
											);
										})}
									</ul>
								)}

								{!!neg.length && (
									<ul className="border-gray-4 space-y-1.5 border-b p-2">
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
														{numberFormatter.format(p.value as number)}
													</span>
												</li>
											);
										})}
									</ul>
								)}

								<div className="flex justify-end p-2 leading-none">
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
