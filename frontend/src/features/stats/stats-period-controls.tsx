import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import type { StatsComparison, StatsPeriod } from "../../api/stats";
import { Input } from "../../ui/input/input";

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodStart(value: string, period: Exclude<StatsPeriod, "custom">) {
  const date = utcDate(value);
  if (period === "week") {
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
  } else if (period === "month") {
    date.setUTCDate(1);
  } else {
    date.setUTCMonth(0, 1);
  }
  return date;
}

function movePeriod(
  value: string,
  period: Exclude<StatsPeriod, "custom">,
  amount: number,
) {
  const date = periodStart(value, period);
  if (period === "week") date.setUTCDate(date.getUTCDate() + 7 * amount);
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  if (period === "year") date.setUTCFullYear(date.getUTCFullYear() + amount);
  return utcDateString(date);
}

type UpdateSearchParams = (next: Record<string, string | undefined>) => void;

export function StatsPeriodControls(props: {
  period: StatsPeriod;
  comparison: StatsComparison;
  today: string;
  monthStart: string;
  from: string;
  to: string;
  anchor: string;
  canCompareYear: boolean;
  update: UpdateSearchParams;
}) {
  const navPeriod = props.period as Exclude<StatsPeriod, "custom">;
  const canGoNext =
    periodStart(props.anchor, navPeriod) < periodStart(props.today, navPeriod);

  const setPeriod = (next: StatsPeriod) => {
    props.update({
      period: next,
      anchor: next === "custom" ? undefined : props.today,
      from: next === "custom" ? props.monthStart : undefined,
      to: next === "custom" ? props.today : undefined,
      compare: next === "year" ? "previous" : props.comparison,
    });
  };

  return (
    <header className="fixed inset-x-0 bottom-9 pwa:bottom-14 z-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-gray-150 bg-gray-0 px-3 py-2 sm:static sm:flex sm:flex-col sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pb-6">
      <div
        className="col-span-full flex items-center gap-0.5 rounded-xl bg-gray-100 p-1 text-sm"
        aria-label="Stats period"
      >
        {(["week", "month", "year", "custom"] as StatsPeriod[]).map((value) => (
          <button
            key={value}
            data-label={value}
            className={`inline-grid flex-1 justify-items-center rounded-[0.6rem] border-0 px-2 py-1 capitalize text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${props.period === value ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
            onClick={() => setPeriod(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {props.period === "custom" ? (
        <div className="col-span-full grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-gray-700">
          <Input
            className="min-w-0"
            aria-label="From date"
            type="date"
            max={props.today}
            value={props.from}
            onInput={(event) =>
              props.update({ from: event.currentTarget.value })
            }
          />
          <span>to</span>
          <Input
            className="min-w-0"
            aria-label="To date"
            type="date"
            max={props.today}
            value={props.to}
            onInput={(event) => props.update({ to: event.currentTarget.value })}
          />
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            className="grid size-9 place-items-center rounded-full border-0 bg-gray-100 text-gray-900 cursor-pointer hover:bg-gray-150"
            aria-label="Previous period"
            onClick={() =>
              props.update({
                anchor: movePeriod(props.anchor, navPeriod, -1),
              })
            }
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <button
            className={`grid size-9 place-items-center rounded-full border-0 bg-gray-100 text-gray-900 cursor-pointer hover:bg-gray-150${canGoNext ? "" : " invisible"}`}
            aria-label="Next period"
            onClick={() =>
              props.update({
                anchor: movePeriod(props.anchor, navPeriod, 1),
              })
            }
          >
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div
        className={`col-start-2 flex items-center justify-self-end gap-2 text-sm${props.canCompareYear ? "" : " invisible"}`}
      >
        <span className="hidden text-gray-700 sm:inline">Compare with</span>
        <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-1 text-sm">
          <button
            data-label="previous"
            className={`inline-grid justify-items-center rounded-[0.6rem] border-0 px-2 py-1 text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${props.comparison === "previous" ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
            onClick={() => props.update({ compare: "previous" })}
          >
            previous
          </button>
          <button
            data-label="last year"
            className={`inline-grid justify-items-center rounded-[0.6rem] border-0 px-2 py-1 text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${props.comparison === "year" ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
            onClick={() => props.update({ compare: "year" })}
          >
            last year
          </button>
        </div>
      </div>
    </header>
  );
}
