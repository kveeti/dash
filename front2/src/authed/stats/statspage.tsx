import { format, isSameMonth } from "date-fns";
import { useState } from "react";
import { useLocaleStuff } from "../use-formatting";
import { testdata } from "./testdata";

export default function StatsPage() {
	const [precision, setPrecision] = useState<"month" | "year">("month");

	return (
		<>
			<Income date={new Date()} />
		</>
	);
}

function Income({ date }: { date: Date }) {
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const { formatAmount } = useLocaleStuff();
	const data = testdata;

	let totalI = 0;
	let totalE = 0;
	for (let i = 0; i < data.data.length; i++) {
		totalI += data.data[i].i.__total__;
		totalE += data.data[i].e.__total__;
	}
	const totalClamp = getClamp(0, Math.max(totalI, totalE));
	const total = totalI - totalE;

	const today = new Date();

	const selected = selectedDate
		? data.data.find((d) => isSameMonth(d.date, selectedDate))
		: data.data.find((d) => isSameMonth(today, d.date));

	const clamp = getClamp(data.domainStart, data.domainEnd);

	return (
		<div className="flex gap-2 w-full">
			<div className="flex flex-col gap-2 w-full">
				<div className="w-full border border-gray-4">
					<h2 className="px-3 py-2 font-medium bg-gray-a2">
						income & expenses
					</h2>

					<div className="divide-y divide-gray-4 border-t border-gray-4">
						{data.data.map((d) => {
							const formattedDate = format(d.date, "MMM");

							return (
								<div
									onMouseEnter={() => {
										setSelectedDate(d.date);
									}}
									className={
										"space-y-1 py-1 px-1" +
										(selected?.date === d.date
											? "  outline-3 outline-gray-10"
											: "")
									}
								>
									<Row
										width={clamp(d.i.__total__)}
										value={formatAmount(d.i.__total__)}
										label={"+ " + formattedDate}
									/>
									<Row
										width={clamp(d.e.__total__)}
										value={formatAmount(d.e.__total__)}
										label={"- " + formattedDate}
									/>
								</div>
							);
						})}
					</div>
				</div>

				<div className="border border-gray-4">
					<h2 className="font-medium flex gap-2 px-3 py-2 bg-gray-a2">
						{format(date, "yyyy")} total
					</h2>

					<div className="space-y-1 p-1">
						<Row
							width={totalClamp(totalI)}
							value={formatAmount(totalI)}
							label={"+"}
						/>
						<Row
							width={totalClamp(totalE)}
							value={formatAmount(totalE)}
							label={"-"}
						/>
					</div>

					<span
						className={
							"text-xs flex justify-end border-t border-gray-4 px-3 py-2" +
							(total > 0 ? " text-green-10" : "")
						}
					>
						{formatAmount(total)}
					</span>
				</div>
			</div>

			<div className="flex flex-col gap-2 w-full">
				<div className="border border-gray-4">
					<div className="flex justify-between gap-2 items-center px-3 py-2 bg-gray-a2">
						<h2 className="font-medium">income</h2>
						{selected && <span>{format(selected.date, "MMM, yyyy")}</span>}
					</div>

					<div className="divide-y divide-gray-4 border-t border-gray-4">
						{selected
							? Object.keys(selected.i)
									.filter((k) => k !== "__total__")
									.sort((ak, bk) => {
										const a = selected.i[ak as keyof typeof selected.i];
										const b = selected.i[bk as keyof typeof selected.i];

										return b - a;
									})
									.map((k) => {
										const val = selected.i[k as keyof typeof selected.i];

										return (
											<div className="space-y-1 py-1 px-1">
												<Row
													width={clamp(val)}
													value={formatAmount(val)}
													label={k}
												/>
											</div>
										);
									})
							: "select a month"}
					</div>
				</div>

				<div className="border border-gray-4">
					<div className="flex justify-between gap-2 items-center px-3 py-2 bg-gray-a2">
						<h2 className="font-medium">expenses</h2>
						{selected && <span>{format(selected.date, "MMM, yyyy")}</span>}
					</div>

					<div className="divide-y divide-gray-4 border-t border-gray-4">
						{selected
							? Object.keys(selected.e)
									.filter((k) => k !== "__total__")
									.sort((ak, bk) => {
										const a = selected.e[ak as keyof typeof selected.e];
										const b = selected.e[bk as keyof typeof selected.e];

										return b - a;
									})
									.map((k) => {
										const val = selected.e[k as keyof typeof selected.e];

										return (
											<div className="space-y-1 py-1 px-1">
												<Row
													width={clamp(val)}
													value={formatAmount(val)}
													label={k}
												/>
											</div>
										);
									})
							: "select a month"}
					</div>
				</div>
			</div>
		</div>
	);
}

function Row({
	width,
	label,
	value,
}: { width: number; label: string; value: string }) {
	return (
		<div className="relative">
			<div
				className="bg-gray-a6/80 absolute inset-0"
				style={{ width: width + "%" }}
			/>

			<div className="py-1 px-2 text-xs flex gap-2 justify-between">
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
