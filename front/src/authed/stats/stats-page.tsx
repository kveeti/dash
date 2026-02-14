import { fromDate, parseDate } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { endOfDay, format, startOfMonth, subYears } from "date-fns";
import { useState } from "react";
import * as Rac from "react-aria-components";
import { useSearchParams } from "wouter";

import { api } from "../../api";
import { buttonStyles } from "../../ui/button";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { useLocaleStuff } from "../use-formatting";

export default function StatsPage() {
	const [searchParams] = useSearchParams();
	const { timeZone } = useLocaleStuff();

	const startq = searchParams.get("start");
	const start = startq
		? parseDate(startq)
		: fromDate(startOfMonth(subYears(new Date(), 1)), timeZone);
	const endq = searchParams.get("end");
	const end = endq ? parseDate(endq) : fromDate(endOfDay(new Date()), timeZone);

	const [value, setValue] = useState<Rac.DateRange>({ start, end });

	return (
		<div className="flex w-full flex-col gap-3">
			<DateField value={value} setValue={setValue} />
			<Thing2 time={value} />
		</div>
	);
}

function Thing2({ time }: { time: Rac.DateRange }) {
	const { timeZone, f } = useLocaleStuff();

	const q = api.useQuery("get", "/v1/transactions/stats", {
		params: {
			query: {
				start: time.start.toDate(timeZone).toISOString(),
				end: time.end.toDate(timeZone).toISOString(),
				tz: timeZone,
			},
		},
	});

	const [selectedDateIndex, setSelectedDateIndex] = useState<number | null>(null);

	if (q.isLoading) {
		return (
			<div className="flex h-60 w-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (q.isError) {
		return <div>Error: {JSON.stringify(q.error)}</div>;
	}

	if (!q.data) {
		return <div>No data</div>;
	}

	const {
		dates,
		tti,
		tte,
		e: expenses,
		i: income,
		n: neutral,
		te,
		ti,
		e_cats,
		i_cats,
		n_cats,
		ti_cats,
		ti_vals,
		te_cats,
		te_vals,
		tn_cats,
		tn_vals,
	} = q.data;

	const selectedDate = typeof selectedDateIndex === "number" ? dates[selectedDateIndex] : null;
	const isTotalSelected = selectedDateIndex === null;

	const selectedIncomeVals = isTotalSelected ? ti_vals : income[selectedDateIndex!];
	const selectedIncomeCats = isTotalSelected ? ti_cats : i_cats[selectedDateIndex!];
	const selectedIncomeTotal = isTotalSelected ? ti : tti[selectedDateIndex!];

	const selectedExpenseVals = isTotalSelected ? te_vals : expenses[selectedDateIndex!];
	const selectedExpenseCats = isTotalSelected ? te_cats : e_cats[selectedDateIndex!];

	const selectedNeutralVals = isTotalSelected ? tn_vals : neutral[selectedDateIndex!];
	const selectedNeutralCats = isTotalSelected ? tn_cats : n_cats[selectedDateIndex!];

	const selectedIncomeSummary = isTotalSelected ? ti : tti[selectedDateIndex!];
	const selectedExpenseSummary = isTotalSelected ? te : tte[selectedDateIndex!];

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
								key={dateIndex}
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
										(sum !== 0 && (isPositive ? "bg-green-10" : "bg-red-9"))
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

				<div
					className={
						"relative " +
						(selectedDateIndex === null ? "outline-gray-10 outline-3" : "")
					}
					onMouseEnter={() => setSelectedDateIndex(null)}
				>
					<SummarySection income={ti} expenses={te} f={f} />
				</div>
			</div>

			<div className="sticky top-14 flex h-max w-full flex-col gap-3 pb-2">
				{(isTotalSelected || selectedDate) && (
					<div className="flex w-full flex-col gap-3">
						<h2>{isTotalSelected ? "total" : format(selectedDate!, "MMM, yyyy")}</h2>

						<CategorySection
							title="income"
							vals={selectedIncomeVals}
							cats={selectedIncomeCats}
							total={selectedIncomeTotal}
							emptyMessage="no income"
							f={f}
						/>

						<CategorySection
							title="expenses"
							vals={selectedExpenseVals}
							cats={selectedExpenseCats}
							total={selectedIncomeTotal}
							emptyMessage="no expenses"
							f={f}
						/>

						{selectedNeutralVals?.length > 0 && (
							<CategorySection
								title="neutral"
								vals={selectedNeutralVals}
								cats={selectedNeutralCats}
								total={selectedIncomeTotal}
								emptyMessage="no neutral"
								f={f}
							/>
						)}

						<SummarySection
							income={selectedIncomeSummary}
							expenses={selectedExpenseSummary}
							f={f}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

function formatCategory(cat: string): string {
	return cat === "__uncategorized__" ? "uncategorized" : cat;
}

interface CategorySectionProps {
	title: string;
	vals: number[] | undefined;
	cats: string[] | undefined;
	total: number;
	emptyMessage: string;
	f: { amount: { format: (n: number) => string } };
}

function CategorySection({ title, vals, cats, total, emptyMessage, f }: CategorySectionProps) {
	return (
		<div className="">
			<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">{title}</h2>
			<div className="divide-gray-4 divide-y">
				{!vals?.length ? (
					<p className="px-2 py-1.5 text-xs">{emptyMessage}</p>
				) : (
					vals.map((val, index) => {
						const cat = formatCategory(cats![index]);
						const clamp = getClamp(0, Math.max(total, val));
						return (
							<div key={index} className="space-y-1 px-1 py-1">
								<Row width={clamp(val)} value={f.amount.format(val)} label={cat} />
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

interface SummarySectionProps {
	income: number;
	expenses: number;
	f: { amount: { format: (n: number) => string } };
}

function SummarySection({ income, expenses, f }: SummarySectionProps) {
	const clamp = getClamp(0, Math.max(income, expenses));
	const sum = income - expenses;

	return (
		<div className="">
			<h2 className="bg-gray-a2 flex gap-3 px-3 py-1 text-xs font-medium">total</h2>
			<div className="divide-gray-4 divide-y">
				<div className="space-y-1 p-1">
					<Row width={clamp(income)} value={f.amount.format(income)} label={"+"} />
					<Row width={clamp(expenses)} value={f.amount.format(expenses)} label={"-"} />
				</div>
				<div>
					<span
						className={
							"flex justify-end px-3 py-1 text-xs" + (sum < 0 ? " text-red-10" : "")
						}
					>
						{f.amount.format(sum)}
					</span>
				</div>
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
				<Rac.Label className={labelStyles}>timerange</Rac.Label>
			</LabelWrapper>

			<Rac.Group className="flex gap-2">
				<Rac.Button
					className={
						buttonStyles({ variant: "outline", size: "icon" }) + " " + "shrink-0"
					}
				>
					<CalendarIcon className="size-4" />
				</Rac.Button>

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
			</Rac.Group>

			<Rac.Popover>
				<Rac.Dialog>
					<Rac.RangeCalendar
						className="bg-gray-1 border-gray-4 border shadow-sm"
						visibleDuration={{ months: 2 }}
						firstDayOfWeek="mon"
						pageBehavior="single"
					>
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

						<div className="flex items-start justify-start gap-1">
							<Rac.CalendarGrid>
								{(date) => (
									<Rac.CalendarCell className={calCellStyles} date={date} />
								)}
							</Rac.CalendarGrid>

							<Rac.CalendarGrid offset={{ months: 1 }}>
								{(date) => (
									<Rac.CalendarCell className={calCellStyles} date={date} />
								)}
							</Rac.CalendarGrid>
						</div>
					</Rac.RangeCalendar>
				</Rac.Dialog>
			</Rac.Popover>
		</Rac.DateRangePicker>
	);
}
