import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { useI18n } from "../i18n/use-i18n";
import type { CategoryValue } from "./stats-category-groups";

export function CategorySection(props: {
  title: string;
  categories: CategoryValue[];
  currency: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  incomplete: boolean;
  goodWhenUp: boolean;
}) {
  if (props.categories.length === 0) return null;

  const max = Math.max(...props.categories.map((row) => row.current), 0);

  return (
    <section className="mb-6">
      <h2 className="mb-2 ms-2.5 text-lg font-medium">{props.title}</h2>
      <ul className="list-none space-y-1.5 rounded-2xl">
        {props.categories.map((category) => {
          const details = [
            ...(category.direct ? [category.direct] : []),
            ...category.children,
          ];
          const isExpanded = props.expanded.has(category.id);
          return (
            <li key={category.id}>
              <CategoryRow
                category={category}
                currency={props.currency}
                max={max}
                incomplete={props.incomplete}
                goodWhenUp={props.goodWhenUp}
                showBar={props.categories.length > 1}
                expandable={details.length > 0}
                expanded={isExpanded}
                onToggle={() => props.onToggle(category.id)}
              />
              {isExpanded && (
                <ul className="ml-6 list-none space-y-1.5">
                  {details.map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        currency={props.currency}
                        max={max}
                        incomplete={props.incomplete}
                        goodWhenUp={props.goodWhenUp}
                        showBar={details.length > 1}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryRow(props: {
  category: CategoryValue;
  currency: string;
  max: number;
  incomplete: boolean;
  goodWhenUp: boolean;
  showBar: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { f } = useI18n();
  const difference = props.category.current - props.category.comparison;
  const showPercent =
    !props.incomplete && props.category.comparison > 0 && difference !== 0;

  const content = (
    <div className="flex justify-between gap-3 w-full leading-5">
      <div>
        <span className="relative z-1 inline-flex items-center gap-1 font-medium">
          {props.category.name}
          {props.expandable && (
            <ChevronRightIcon
              className="size-4 shrink-0 transition-transform duration-150 [button[aria-expanded=true]_&]:rotate-90"
              aria-hidden="true"
            />
          )}
        </span>
      </div>

      <div className="flex flex-col">
        <span className="relative z-1 text-end font-medium">
          {f.wholeAmount(props.category.current, props.currency)}
        </span>
        <span className="relative z-1 text-end text-xs text-gray-900">
          vs {f.wholeAmount(props.category.comparison, props.currency)}
          {showPercent && (
            <>
              {" "}
              <span
                className={
                  difference > 0 === props.goodWhenUp
                    ? "text-green-950 py-0.5 px-1 bg-green-220 border border-green-300/80 rounded-md text-[0.65rem]"
                    : "text-red-950 py-0.5 px-1 bg-red-280 border border-red-300/80 rounded-md text-[0.65rem]"
                }
              >
                {f.percent(difference / props.category.comparison)}
              </span>
            </>
          )}
        </span>
        <span className="absolute inset-0 -z-1 bg-gray-100">
          {props.showBar && (
            <span
              className="block h-full bg-(--stats-bar-visual)"
              style={{
                width: `${props.max > 0 ? (Math.max(props.category.current, 0) / props.max) * 100 : 0}%`,
              }}
            />
          )}
        </span>
      </div>
    </div>
  );

  if (!props.expandable) {
    return (
      <div className="p-2.5 relative isolate w-full overflow-hidden rounded-xl border-0 bg-transparent text-start text-gray-900">
        {content}
      </div>
    );
  }

  return (
    <button
      className="px-3 py-2 relative isolate w-full cursor-pointer overflow-hidden rounded-xl bg-transparent text-start text-gray-900 hover:bg-gray-100 hover:shadow-[0_1px_3px] hover:shadow-gray-200"
      aria-expanded={props.expanded}
      onClick={() => props.onToggle?.()}
    >
      {content}
    </button>
  );
}
