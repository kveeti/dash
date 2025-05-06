import { format } from "date-fns";
import { useState } from "react";

import { useLocaleStuff } from "../use-formatting";
import { testdata } from "./testdata";

export default function StatsPage() {
	const [precision, setPrecision] = useState<"month" | "year">("month");

	return (
		<>
			<Thing2 />
		</>
	);
}

function Thing2() {
	const { dates, i_cats, e_cats, i: income, e: expenses, tte, tti, ti, te } = testdata;

	const [selectedDateIndex, setSelectedDateIndex] = useState<number | null>(null);
	const selectedDate = typeof selectedDateIndex === "number" ? dates[selectedDateIndex] : null;

	const { formatAmount } = useLocaleStuff();

	return (
		<div className="flex w-full gap-3">
			<div className="flex w-full flex-col gap-3">
				<div className="border-gray-4 w-full border">
					{dates.map((d, dateIndex) => {
						const date = new Date(d);
						const i = tti[dateIndex];
						const e = tte[dateIndex];

						const clamp = getClamp(0, Math.max(i, e));

						const month = format(date, "MMM");

						return (
							<div
								className={
									"space-y-1 p-1" +
									(selectedDateIndex === dateIndex
										? " outline-gray-10 outline-3"
										: "")
								}
								onMouseEnter={() => setSelectedDateIndex(dateIndex)}
							>
								<Row
									width={clamp(i)}
									value={formatAmount(i)}
									label={"+ " + month}
								/>
								<Row
									width={clamp(e)}
									value={formatAmount(e)}
									label={"- " + month}
								/>
							</div>
						);
					})}
				</div>

				<div className="border-gray-4 border">
					<h2 className="bg-gray-a2 flex gap-3 px-3 py-2 font-medium">total</h2>

					<div className="divide-gray-4 border-gray-4 divide-y border-t">
						<div className="space-y-1 p-1">
							<Row
								width={getClamp(0, Math.max(ti, te))(ti)}
								value={formatAmount(ti)}
								label={"+"}
							/>
							<Row
								width={getClamp(0, Math.max(ti, te))(te)}
								value={formatAmount(te)}
								label={"-"}
							/>
						</div>

						<div>
							<span
								className={
									"flex justify-end px-3 py-1 text-xs" +
									(ti - te > 0 ? " text-green-10" : "")
								}
							>
								{formatAmount(ti - te)}
							</span>
						</div>
					</div>
				</div>
			</div>

			<div className="sticky top-14 flex h-max w-full flex-col gap-3 pb-2">
				{typeof selectedDateIndex === "number" && selectedDate && (
					<>
						<div className="border-gray-4 border">
							<h2 className="bg-gray-a2 flex gap-3 px-3 py-2 font-medium">
								income {format(selectedDate, "MMM, yyyy")}
							</h2>

							<div className="divide-gray-4 border-gray-4 divide-y border-t">
								{income[selectedDateIndex].map((val, index) => {
									const cat = i_cats[selectedDateIndex][index];
									const i = tti[selectedDateIndex];
									const clamp = getClamp(0, Math.max(i, val));

									return (
										<div className="space-y-1 px-1 py-1">
											<Row
												width={clamp(val)}
												value={formatAmount(val)}
												label={cat}
											/>
										</div>
									);
								})}
							</div>
						</div>

						<div className="border-gray-4 border">
							<h2 className="bg-gray-a2 flex gap-3 px-3 py-2 font-medium">
								expenses {format(selectedDate, "MMM, yyyy")}
							</h2>

							<div className="divide-gray-4 border-gray-4 divide-y border-t">
								{expenses[selectedDateIndex].map((val, index) => {
									const cat = e_cats[selectedDateIndex][index];
									const i = tti[selectedDateIndex];
									const clamp = getClamp(0, Math.max(i, val));

									return (
										<div className="space-y-1 px-1 py-1">
											<Row
												width={clamp(val)}
												value={formatAmount(val)}
												label={cat}
											/>
										</div>
									);
								})}
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function Row({ width, label, value }: { width: number; label: string; value: string }) {
	return (
		<div className="relative">
			<div className="bg-gray-a6/80 absolute inset-0" style={{ width: width + "%" }} />

			<div className="flex justify-between gap-3 px-2 py-0.5 text-xs">
				<span>{label}</span>
				<span>{value}</span>
			</div>
		</div>
	);
}

function getClamp(min: number, max: number) {
	return function clamp(num: number) {
		const numAbs = Math.abs(num);
		const normalized = Math.min(Math.max((numAbs - min) / (max - min), 0), 1);
		return normalized * 100;
	};
}
