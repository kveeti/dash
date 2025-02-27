import { endOfDay, format, isAfter, isBefore, startOfMonth, startOfYear, subYears } from "date-fns";
import { type ChangeEvent } from "react";
import { useLocation, useSearch } from "wouter";

import { Input } from "../../ui/input";
import { CumulativeChart } from "./cumulative-chart";
import { FirstChart } from "./first-chart";

export const CHART_SYNC_ID = "hi";

export default function TransactionStatsPage() {
	const [location, navigate] = useLocation();
	const searchParams = new URLSearchParams(useSearch());

	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

			<div className="space-y-10">
				<FirstChart timeframe={timeframe} timezone={timezone} />
				<CumulativeChart timeframe={timeframe} timezone={timezone} />
			</div>
		</div>
	);
}
