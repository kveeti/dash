import { parseDate } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { format, subYears } from "date-fns";
import { useState } from "react";
import * as Rac from "react-aria-components";

import { api } from "../../api";
import { buttonStyles } from "../../ui/button";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { useLocaleStuff } from "../use-formatting";
import { testdata } from "./testdata";

export default function StatsPage() {
	const [precision, setPrecision] = useState<"month" | "year">("month");
	const { timeZone } = useLocaleStuff();

	const [value, setValue] = useState<Rac.DateRange | null>({
		start: parseDate("2023-01-01"),
		end: parseDate("2023-12-31"),
	});

	let year = subYears(new Date(), 1);

	const q = api.useQuery("get", "/transactions/stats", {
		params: {
			query: {
				timezone: timeZone,
				start: value.start.toDate(timeZone).toISOString(),
				end: value.end.toDate(timeZone).toISOString(),
			},
		},
	});

	if (q.isLoading) {
		return <div>Loading...</div>;
	}

	if (q.isError) {
		return <div>Error: {JSON.stringify(q.error)}</div>;
	}

	if (!q.data) {
		return <div>No data</div>;
	}

	return (
		<div className="flex w-full flex-col gap-3">
			<DateField value={value} setValue={setValue} />
			<Thing2 data={q.data} />
		</div>
	);
}

function DateField({
	value,
	setValue,
}: {
	value: Rac.DateRange;
	setValue: (val: Rac.DateRange | null) => void;
}) {
	const { hourCycle } = useLocaleStuff();

	const calCellStyles =
		buttonStyles({ variant: "ghost", size: "icon" }) + " data-selected:bg-gray-a4";

	return (
		<Rac.DateRangePicker
			granularity="day"
			hourCycle={hourCycle}
			value={value}
			onChange={setValue}
		>
			<LabelWrapper>
				<Rac.Label className={labelStyles}>start</Rac.Label>
			</LabelWrapper>

			<Rac.Group className="flex gap-2">
				<Rac.DateInput slot="start" className={inputStyles + " inline-flex items-center"}>
					{(segment) => (
						<Rac.DateSegment
							segment={segment}
							className={
								"inline p-1 leading-4 caret-transparent outline-none" +
								" data-[type=literal]:p-0" +
								" data-[type=year]:-me-1" +
								" data-focused:bg-gray-a7 data-focused:text-white"
							}
						/>
					)}
				</Rac.DateInput>

				<Rac.DateInput slot="end" className={inputStyles + " inline-flex items-center"}>
					{(segment) => (
						<Rac.DateSegment
							segment={segment}
							className={
								"inline p-1 leading-4 caret-transparent outline-none" +
								" data-[type=literal]:p-0" +
								" data-[type=year]:-me-1" +
								" data-focused:bg-gray-a7 data-focused:text-white"
							}
						/>
					)}
				</Rac.DateInput>
				<Rac.Button className={buttonStyles({ variant: "outline", size: "icon" })}>
					<CalendarIcon className="size-4" />
				</Rac.Button>
			</Rac.Group>

			<Rac.Popover>
				<Rac.Dialog>
					<Rac.RangeCalendar className="bg-gray-1 border-gray-4 border shadow-sm">
						<header className="mb-2 flex items-center justify-between gap-2">
							<Rac.Button
								slot="previous"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronLeft />
							</Rac.Button>
							<Rac.Heading />
							<Rac.Button
								slot="next"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronRight />
							</Rac.Button>
						</header>
						<Rac.CalendarGrid>
							{(date) => <Rac.CalendarCell className={calCellStyles} date={date} />}
						</Rac.CalendarGrid>
					</Rac.RangeCalendar>
				</Rac.Dialog>
			</Rac.Popover>
		</Rac.DateRangePicker>
	);
}

function Thing2({
	data: { dates, i_cats, e_cats, i: income, e: expenses, tte, tti, ti, te },
}: {
	data: typeof testdata;
}) {
	const { f } = useLocaleStuff();

	const [selectedDateIndex, setSelectedDateIndex] = useState<number | null>(null);
	const selectedDate = typeof selectedDateIndex === "number" ? dates[selectedDateIndex] : null;

	return (
		<div className="flex w-full gap-3">
			<div className="flex w-full flex-col gap-3">
				<div className="w-full space-y-2">
					{dates.map((d, dateIndex) => {
						const date = new Date(d);
						const i = tti[dateIndex];
						const e = tte[dateIndex];

						const clamp = getClamp(0, Math.max(i, e));

						const month = format(date, "MMM");

						const sum = i - e;
						const isPositive = sum > 0;

						return (
							<div
								className={
									"relative " +
									(selectedDateIndex === dateIndex
										? "outline-gray-10 outline-3"
										: "")
								}
								onMouseEnter={() => setSelectedDateIndex(dateIndex)}
							>
								<div
									className={
										"absolute top-1 right-7 size-6 rounded-full " +
										(isPositive ? "bg-green-10" : "bg-red-9")
									}
								></div>
								<div className="absolute inset-0 backdrop-blur-2xl"></div>

								<h3 className="bg-gray-a2 relative px-2 py-1 text-xs font-medium">
									{month}
								</h3>

								<div className="relative space-y-1 p-1">
									<Row width={clamp(i)} value={f.amount.format(i)} label={"+"} />
									<Row width={clamp(e)} value={f.amount.format(e)} label={"-"} />
								</div>
							</div>
						);
					})}
				</div>

				<div className="">
					<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">total</h2>

					<div className="divide-gray-4 divide-y">
						<div className="space-y-1 p-1">
							<Row
								width={getClamp(0, Math.max(ti, te))(ti)}
								value={f.amount.format(ti)}
								label={"+"}
							/>
							<Row
								width={getClamp(0, Math.max(ti, te))(te)}
								value={f.amount.format(te)}
								label={"-"}
							/>
						</div>

						<div>
							<span
								className={
									"flex justify-end px-3 py-1 text-xs" +
									(ti - te < 0 ? " text-red-10" : "")
								}
							>
								{f.amount.format(ti - te)}
							</span>
						</div>
					</div>
				</div>
			</div>

			<div className="sticky top-14 flex h-max w-full flex-col gap-3 pb-2">
				{typeof selectedDateIndex === "number" && selectedDate && (
					<div className="flex w-full flex-col gap-3">
						<h2>{format(selectedDate, "MMM, yyyy")}</h2>

						<div className="">
							<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">
								income
							</h2>

							<div className="divide-gray-4 divide-y">
								{!income[selectedDateIndex].length ? (
									<p className="px-2 py-1.5 text-xs">no income</p>
								) : (
									income[selectedDateIndex].map((val, index) => {
										let cat = i_cats[selectedDateIndex][index];
										if (cat === "__uncategorized__") {
											cat = "uncategorized";
										}
										const i = tti[selectedDateIndex];
										const clamp = getClamp(0, Math.max(i, val));

										return (
											<div className="space-y-1 px-1 py-1">
												<Row
													width={clamp(val)}
													value={f.amount.format(val)}
													label={cat}
												/>
											</div>
										);
									})
								)}
							</div>
						</div>

						<div className="">
							<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">
								expenses
							</h2>

							<div className="divide-gray-4 divide-y">
								{!expenses[selectedDateIndex].length ? (
									<p className="px-2 py-1.5 text-xs">no expenses</p>
								) : (
									expenses[selectedDateIndex].map((val, index) => {
										let cat = e_cats[selectedDateIndex][index];
										if (cat === "__uncategorized__") {
											cat = "uncategorized";
										}
										const i = tti[selectedDateIndex];
										const clamp = getClamp(0, Math.max(i, val));

										return (
											<div className="space-y-1 px-1 py-1">
												<Row
													width={clamp(val)}
													value={f.amount.format(val)}
													label={cat}
												/>
											</div>
										);
									})
								)}
							</div>
						</div>

						{(() => {
							const i = tti[selectedDateIndex];
							const e = tte[selectedDateIndex];

							const clamp = getClamp(0, Math.max(i, e));

							const sum = i - e;

							return (
								<div className="">
									<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">
										total
									</h2>

									<div className="divide-gray-4 divide-y">
										<div className="space-y-1 p-1">
											<Row
												width={clamp(i)}
												value={f.amount.format(i)}
												label={"+"}
											/>
											<Row
												width={clamp(e)}
												value={f.amount.format(e)}
												label={"-"}
											/>
										</div>

										<div>
											<span
												className={
													"flex justify-end px-3 py-1 text-xs" +
													(sum < 0 ? " text-red-10" : "")
												}
											>
												{f.amount.format(sum)}
											</span>
										</div>
									</div>
								</div>
							);
						})()}
					</div>
				)}
			</div>
		</div>
	);
}

function Row({ width, label, value }: { width: number; label: string; value: string }) {
	return (
		<div className="relative">
			<div className="bg-gray-a5 absolute inset-0" style={{ width: width + "%" }} />

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
