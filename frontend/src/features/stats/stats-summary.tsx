import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
} from "@heroicons/react/24/outline";

import type { StatsAmount, Valuation } from "../../api/stats";
import { useI18n } from "../i18n/use-i18n";

export function Summary(props: {
  label: string;
  value: StatsAmount;
  currency: string;
  incomplete: boolean;
  goodWhenUp: boolean;
}) {
  const { f } = useI18n();
  const difference = props.value.current - props.value.comparison;
  const showPercent =
    !props.incomplete && props.value.comparison !== 0 && difference !== 0;

  return (
    <article className="w-full min-w-0 rounded-2xl bg-gray-100 p-3 flex flex-col gap-1">
      <h2 className="text-sm font-semibold leading-5 text-gray-500">
        {props.label}
      </h2>

      <div className="flex flex-col justify-end h-full">
        {showPercent ? (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${difference > 0 === props.goodWhenUp ? "text-(--green-fg)" : "text-(--red-fg)"}`}
          >
            {difference > 0 ? (
              <ArrowUpRightIcon
                className="size-2.5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            ) : (
              <ArrowDownRightIcon
                className="size-2.5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}

            <span>
              {f.percent(difference / Math.abs(props.value.comparison))}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" className="invisible">
            0
          </span>
        )}

        <strong className="block text-xl font-semibold leading-6 wrap-anywhere tabular-nums">
          {f.amount(props.value.current, props.currency)}
        </strong>

        <p className="text-xs text-gray-700 tabular-nums mt-1">
          vs {f.amount(props.value.comparison, props.currency)}
        </p>
      </div>
    </article>
  );
}

export function ValuationNotice(props: {
  valuation: { current: Valuation; comparison: Valuation };
}) {
  const values = [props.valuation.current, props.valuation.comparison];
  const fallbackCount = values.reduce(
    (sum, value) => sum + value.fallback_transactions,
    0,
  );
  const oldest = Math.max(
    ...values.map((value) => value.maximum_fallback_days),
  );
  const missing = [
    ...new Set(values.flatMap((value) => value.unvalued_currencies)),
  ];

  if (fallbackCount === 0 && missing.length === 0) return null;

  return (
    <aside className="mb-6 rounded-2xl border-0 bg-gray-100 p-3 text-sm text-gray-700">
      {fallbackCount > 0 && (
        <p>
          Some values use an earlier exchange rate, up to {oldest} days old.
        </p>
      )}
      {missing.length > 0 && (
        <p>
          {missing.join(", ")} could not be valued and is excluded from totals.
        </p>
      )}
    </aside>
  );
}
