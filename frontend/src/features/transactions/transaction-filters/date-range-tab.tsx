import { CalendarDaysIcon } from "@heroicons/react/24/outline";

import { setSearchParams, useSearchParam } from "../../../lib/search-param";
import { Input } from "../../../ui/input/input";
import { rangeDates, type DateRange } from "./date-range";
import { DateRangePicker } from "./date-range-picker";
import { TabPanel, TabTrigger } from "./filter-button";

export function Trigger(props: { applied: boolean }) {
  return (
    <TabTrigger
      value="date"
      label="Date range"
      Icon={CalendarDaysIcon}
      applied={props.applied}
    />
  );
}

export function Panel() {
  const range = (useSearchParam("range") ?? "all-time") as DateRange;
  const start = useSearchParam("start");
  const end = useSearchParam("end");
  const dates = rangeDates(range, start, end);
  const updateRange = (next: DateRange) => {
    const nextDates = rangeDates(next, start, end);
    setSearchParams(
      {
        range: next === "all-time" ? undefined : next,
        start: next === "custom" ? nextDates.start || undefined : undefined,
        end: next === "custom" ? nextDates.end || undefined : undefined,
      },
      { replace: true },
    );
  };

  return (
    <TabPanel value="date">
      <section aria-label="Date range filter" className="space-y-4">
        <h2 className="font-medium">Date range</h2>
        <div className="text-sm text-gray-700">
          <span>Quick select</span>
          <DateRangePicker range={range} onChange={updateRange} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-gray-700">
            Start
            <Input
              className="mt-1"
              type="date"
              value={dates.start}
              onInput={(event) =>
                setSearchParams(
                  {
                    range: "custom",
                    start: event.currentTarget.value || undefined,
                  },
                  { replace: true },
                )
              }
            />
          </label>
          <label className="text-sm text-gray-700">
            End
            <Input
              className="mt-1"
              type="date"
              value={dates.end}
              onInput={(event) =>
                setSearchParams(
                  {
                    range: "custom",
                    end: event.currentTarget.value || undefined,
                  },
                  { replace: true },
                )
              }
            />
          </label>
        </div>
      </section>
    </TabPanel>
  );
}
