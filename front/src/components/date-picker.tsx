import {
	parseDate,
	parseDateTime,
	startOfWeek as startOfWeekDateValue,
	type DateValue,
} from "@internationalized/date";
import { useCalendarGrid } from "react-aria";
import { useContext } from "react";
import {
	Button,
	Calendar,
	CalendarStateContext,
	CalendarCell,
	DateInput,
	DateRangePicker as AriaDateRangePicker,
	DatePicker,
	DateSegment,
	Dialog,
	Group,
	Heading,
	Label,
	Popover,
	RangeCalendar as AriaRangeCalendar,
	RangeCalendarStateContext,
	useLocale,
} from "react-aria-components";
import type { CalendarState } from "react-stately/useCalendarState";
import type { RangeCalendarState } from "react-stately/useRangeCalendarState";
import { IconCalendar } from "./icons/calendar";
import { IconChevronLeft } from "./icons/chevron-left";
import { IconChevronRight } from "./icons/chevron-right";

type DateChangeEvent = {
	currentTarget: {
		value: string;
	};
	target: {
		value: string;
	};
};

type DateRangeChangeValue = {
	from: string;
	to: string;
};

type PickerGranularity = "day" | "minute";
type LocaleWeekInfo = { firstDay: number; minimalDays: number };
type LocaleWithWeekInfo = Intl.Locale & {
	getWeekInfo?: () => Partial<LocaleWeekInfo>;
	weekInfo?: Partial<LocaleWeekInfo>;
};

const MILLISECONDS_IN_WEEK = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_MIN_WEEK_ROWS = 6;
const localeWeekInfoCache = new Map<string, LocaleWeekInfo>();
type CalendarStateLike = CalendarState | RangeCalendarState<DateValue>;

export function DatePickerInput(props: Omit<DatePickerInputBaseProps, "granularity">) {
	return <DatePickerInputBase {...props} granularity="day" />;
}

export function DateTimePickerInput(props: Omit<DatePickerInputBaseProps, "granularity">) {
	return <DatePickerInputBase {...props} granularity="minute" />;
}

export function DateRangePickerInput({
	label,
	value,
	onChange,
	disabled = false,
	size = "default",
	showWeekNumbers = false,
	className,
}: {
	label?: string;
	value: DateRangeChangeValue;
	onChange?: (value: DateRangeChangeValue) => void;
	disabled?: boolean;
	size?: "sm" | "default";
	showWeekNumbers?: boolean;
	className?: string;
}) {
	const parsedRange = parseDateRangeValue(value);

	return (
		<AriaDateRangePicker
			value={parsedRange}
			isDisabled={disabled}
			className="flex flex-col gap-1"
			onChange={(next) => {
				if (!next?.start || !next?.end) return;
				onChange?.({
					from: next.start.toString(),
					to: next.end.toString(),
				});
			}}
		>
			{label ? <Label className="text-gray-11 text-xs">{label}</Label> : null}
			<Group
				className={
					"focus border-gray-6 bg-gray-1 border flex items-center data-[disabled]:opacity-60 " +
					(size === "sm" ? "h-8 text-xs" : "h-10 text-sm") +
					(className ? ` ${className}` : "")
				}
			>
				<div className="flex flex-1 items-center overflow-x-auto overflow-y-clip [scrollbar-width:none]">
					<DateInput slot="start" className="flex items-center px-2">
						{(segment) => (
							<DateSegment
								segment={segment}
								className={segmentClassName(segment.type)}
							/>
						)}
					</DateInput>
					<span aria-hidden className="text-gray-10">-</span>
					<DateInput slot="end" className="flex items-center px-2">
						{(segment) => (
							<DateSegment
								segment={segment}
								className={segmentClassName(segment.type)}
							/>
						)}
					</DateInput>
				</div>
				<Button className="focus border-l border-gray-a4 hover:bg-gray-a2 h-full w-8 cursor-default flex items-center justify-center text-gray-10">
					<IconCalendar />
				</Button>
			</Group>
			<Popover className="z-50 border border-gray-a4 bg-gray-1 p-0 shadow-lg cursor-default">
				<Dialog className="outline-none">
					<AriaRangeCalendar className="cursor-default">
						<header className="mb-2 flex items-center justify-between px-1 pt-1">
							<Button
								slot="previous"
								className="hover:bg-gray-a2 h-7 w-7 flex items-center justify-center outline-none"
							>
								<IconChevronLeft />
							</Button>
							<Heading className="text-xs text-gray-11 font-mono text-center" />
							<Button
								slot="next"
								className="hover:bg-gray-a2 h-7 w-7 flex items-center justify-center outline-none"
							>
								<IconChevronRight />
							</Button>
						</header>
						<RangeCalendarGrid showWeekNumbers={showWeekNumbers} />
					</AriaRangeCalendar>
				</Dialog>
			</Popover>
		</AriaDateRangePicker>
	);
}

function RangeCalendarGrid({ showWeekNumbers }: { showWeekNumbers: boolean }) {
	const state = useContext(RangeCalendarStateContext);
	if (!state) return null;
	return (
		<WeekNumberCalendarTable
			state={state}
			showWeekNumbers={showWeekNumbers}
			cellVariant="range"
		/>
	);
}

type DatePickerInputBaseProps = {
	label?: string;
	name?: string;
	value?: string;
	defaultValue?: string;
	onChange?: (event: DateChangeEvent) => void;
	required?: boolean;
	disabled?: boolean;
	size?: "sm" | "default";
	showWeekNumbers?: boolean;
	className?: string;
	granularity: PickerGranularity;
};

function DatePickerInputBase({
	label,
	name,
	value,
	defaultValue,
	onChange,
	required = false,
	disabled = false,
	size = "default",
	showWeekNumbers = true,
	className,
	granularity,
}: DatePickerInputBaseProps) {
	const isControlled = value !== undefined;
	const parsedValue = parseDateValue(value ?? "", granularity);
	const parsedDefaultValue = parseDateValue(defaultValue ?? "", granularity);

	return (
		<DatePicker
			{...(isControlled ? { value: parsedValue ?? null } : { defaultValue: parsedDefaultValue ?? undefined })}
			name={name}
			granularity={granularity}
			isDisabled={disabled}
			isRequired={required}
			className="flex flex-col gap-1"
			onChange={(nextValue) => {
				onChange?.({
					currentTarget: { value: nextValue?.toString() ?? "" },
					target: { value: nextValue?.toString() ?? "" },
				});
			}}
		>
			{label ? <Label className="text-gray-11 text-xs">{label}</Label> : null}
			<Group
				className={
					"focus border-gray-6 bg-gray-1 border flex items-center data-[disabled]:opacity-60 " +
					(size === "sm" ? "h-8 text-xs" : "h-10 text-sm") +
					(className ? ` ${className}` : "")
				}
			>
				<DateInput className="flex flex-1 items-center overflow-x-auto overflow-y-clip px-3 [scrollbar-width:none]">
					{(segment) => (
						<DateSegment
							segment={segment}
							className={segmentClassName(segment.type)}
						/>
					)}
				</DateInput>
				<Button className="border-l border-gray-a4 hover:bg-gray-a2 w-10 h-10 cursor-default flex items-center justify-center text-gray-10 outline-none">
					<IconCalendar />
				</Button>
			</Group>
			<Popover className="z-50 border border-gray-a4 bg-gray-1 p-0 shadow-lg cursor-default">
				<Dialog className="outline-none">
					<Calendar className="cursor-default">
						<header className="mb-2 flex items-center justify-between px-1 pt-1">
							<Button
								slot="previous"
								className="hover:bg-gray-a2 h-7 w-7 flex items-center justify-center outline-none"
							>
								<IconChevronLeft />
							</Button>
							<Heading className="text-xs text-gray-11 font-mono text-center" />
							<Button
								slot="next"
								className="hover:bg-gray-a2 h-7 w-7 flex items-center justify-center outline-none"
							>
								<IconChevronRight />
							</Button>
						</header>
						<SingleCalendarGrid showWeekNumbers={showWeekNumbers} />
					</Calendar>
				</Dialog>
			</Popover>
		</DatePicker>
	);
}

function SingleCalendarGrid({ showWeekNumbers }: { showWeekNumbers: boolean }) {
	const state = useContext(CalendarStateContext);
	if (!state) return null;
	return (
		<WeekNumberCalendarTable
			state={state}
			showWeekNumbers={showWeekNumbers}
			cellVariant="single"
		/>
	);
}

function WeekNumberCalendarTable({
	state,
	showWeekNumbers,
	cellVariant,
}: {
	state: CalendarStateLike;
	showWeekNumbers: boolean;
	cellVariant: "single" | "range";
}) {
	const { locale } = useLocale();
	const { gridProps, headerProps, weekDays } = useCalendarGrid(
		{ weekdayStyle: "narrow" },
		state,
	);
	const gridStartDate = startOfWeekDateValue(state.visibleRange.start, locale);

	return (
		<table {...gridProps} className="border-spacing-0">
			<thead {...headerProps}>
				<tr>
					{showWeekNumbers ? (
						<th className="w-8 h-6 text-center text-[11px] text-gray-10 font-normal">Wk</th>
					) : null}
					{weekDays.map((day, index) => (
						<th
							key={index}
							className="w-8 h-6 text-center text-[11px] text-gray-10 font-normal"
						>
							{day}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{Array.from({ length: CALENDAR_MIN_WEEK_ROWS }, (_, weekIndex) => {
					const weekStartDate = gridStartDate.add({ days: weekIndex * 7 });
					const dates = Array.from(
						{ length: 7 },
						(_, dayIndex) => weekStartDate.add({ days: dayIndex }),
					);
					const weekNumber = getLocaleWeekNumber(weekStartDate.toDate("UTC"), locale);

					return (
						<tr key={weekIndex}>
							{showWeekNumbers ? (
								<td className="w-8 h-8 p-0 text-center text-[11px] text-gray-9 font-mono select-none cursor-default">
									{weekNumber}
								</td>
							) : null}
							{dates.map((date, dayIndex) => {
								if (cellVariant === "range") {
									return (
										<CalendarCell
											key={dayIndex}
											date={date}
											className={({ isSelected, isDisabled, isOutsideVisibleRange }) =>
												"group w-8 h-8 p-0 cursor-default select-none outline-none " +
												(isOutsideVisibleRange ? "text-gray-9 " : "text-gray-12 ") +
												(isDisabled ? "opacity-40 " : "hover:bg-gray-a2 ") +
												(isSelected ? "bg-gray-a2 " : "")
											}
										>
											{({
												formattedDate,
												isSelected,
												isSelectionStart,
												isSelectionEnd,
												isDisabled,
											}) => (
												<span
													className={
														"w-8 h-8 flex items-center justify-center text-center leading-none cursor-default select-none " +
														(isDisabled ? "opacity-40 " : "") +
														(
															isSelected && (isSelectionStart || isSelectionEnd)
																? "bg-gray-a3 "
																: ""
														)
													}
												>
													{formattedDate}
												</span>
											)}
										</CalendarCell>
									);
								}

								return (
									<CalendarCell
										key={dayIndex}
										date={date}
										className={({ isSelected, isDisabled, isOutsideVisibleRange }) =>
											"w-8 h-8 !cursor-default select-none flex items-center justify-center text-sm text-center leading-none outline-none forced-color-adjust-none [-webkit-tap-highlight-color:transparent] " +
											(isOutsideVisibleRange ? "text-gray-9 " : "text-gray-12 ") +
											(isDisabled
												? "opacity-40 text-gray-9 "
												: isSelected
													? "bg-gray-a3 text-gray-12 "
													: "hover:bg-gray-a2 ")
										}
									/>
								);
							})}
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function getLocaleWeekNumber(date: Date, locale: string) {
	const weekInfo = getLocaleWeekInfo(locale);
	const target = toUtcDateOnly(date);
	const weekYear = getWeekYearForDate(target, weekInfo);
	const weekYearStart = getStartOfWeekYear(weekYear, weekInfo);
	const weekStart = getStartOfWeek(target, weekInfo.firstDay % 7);
	return Math.floor((weekStart.getTime() - weekYearStart.getTime()) / MILLISECONDS_IN_WEEK) + 1;
}

function getWeekYearForDate(date: Date, weekInfo: LocaleWeekInfo) {
	const year = date.getUTCFullYear();
	const startOfCurrentWeekYear = getStartOfWeekYear(year, weekInfo);
	if (date < startOfCurrentWeekYear) {
		return year - 1;
	}

	const startOfNextWeekYear = getStartOfWeekYear(year + 1, weekInfo);
	return date >= startOfNextWeekYear ? year + 1 : year;
}

function getStartOfWeekYear(
	year: number,
	weekInfo: LocaleWeekInfo,
) {
	const januaryFirst = new Date(Date.UTC(year, 0, 1));
	const firstDayJs = weekInfo.firstDay % 7;
	const firstWeekStart = getStartOfWeek(januaryFirst, firstDayJs);
	const daysSinceWeekStart = (januaryFirst.getUTCDay() - firstDayJs + 7) % 7;
	const daysInFirstWeek = 7 - daysSinceWeekStart;
	return daysInFirstWeek >= weekInfo.minimalDays
		? firstWeekStart
		: shiftUtcDays(firstWeekStart, 7);
}

function getLocaleWeekInfo(locale: string) {
	const cachedWeekInfo = localeWeekInfoCache.get(locale);
	if (cachedWeekInfo) return cachedWeekInfo;

	const localeInfo = new Intl.Locale(locale) as LocaleWithWeekInfo;
	const weekInfo =
		typeof localeInfo.getWeekInfo === "function"
			? localeInfo.getWeekInfo()
			: localeInfo.weekInfo;
	if (
		weekInfo &&
		typeof weekInfo.firstDay === "number" &&
		typeof weekInfo.minimalDays === "number"
	) {
		const resolvedWeekInfo = {
			firstDay: weekInfo.firstDay,
			minimalDays: weekInfo.minimalDays,
		};
		localeWeekInfoCache.set(locale, resolvedWeekInfo);
		return resolvedWeekInfo;
	}

	const fallbackWeekInfo = { firstDay: 1, minimalDays: 4 };
	localeWeekInfoCache.set(locale, fallbackWeekInfo);
	return fallbackWeekInfo;
}

function toUtcDateOnly(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getStartOfWeek(date: Date, firstDayJs: number) {
	const daysSinceWeekStart = (date.getUTCDay() - firstDayJs + 7) % 7;
	return shiftUtcDays(date, -daysSinceWeekStart);
}

function shiftUtcDays(date: Date, days: number) {
	const next = new Date(date.getTime());
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function segmentClassName(type: string) {
	return type === "literal"
		? "text-gray-10 mx-0.5"
		: "data-[placeholder]:text-gray-9 data-[focused]:bg-gray-a6 outline-none px-0.5 -mx-0.5";
}

function parseDateRangeValue(value: DateRangeChangeValue) {
	try {
		return {
			start: parseDate(value.from),
			end: parseDate(value.to),
		};
	} catch {
		return null;
	}
}

function parseDateValue(
	raw: string,
	granularity: PickerGranularity,
): DateValue | null {
	const value = raw.trim();
	if (!value) return null;

	try {
		if (granularity === "day") {
			return parseDate(value);
		}
		return parseDateTime(value);
	} catch {
		return null;
	}
}
