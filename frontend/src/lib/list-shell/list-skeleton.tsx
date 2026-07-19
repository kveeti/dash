import { Fragment } from "react";

const groups = [3, 1, 4, 2, 3, 5, 2, 1, 4, 3, 2, 6, 1, 3, 2];
const widths = ["9rem", "13rem", "7rem", "11rem", "10rem", "8rem"];
const metaWidths = ["5rem", "7rem", "4rem", "6rem", "5.5rem"];

export function ListSkeleton({ twoLine = false }: { twoLine?: boolean }) {
  let i = 0;

  return (
    <ul className="-mt-1 flex list-none flex-col" aria-hidden="true">
      {groups.map((count, g) => (
        <Fragment key={g}>
          <li
            role="presentation"
            className="sticky -top-1 z-1 text-sm text-gray-700 sm:top-[calc(var(--nav-height)+var(--filterbar-height)-var(--spacing))]"
          >
            <span className="mx-auto my-1 block h-[1.7rem] max-w-(--page-width) animate-pulse rounded-lg bg-gray-150" />
          </li>
          {Array.from({ length: count }, () => {
            const width = widths[i % widths.length];
            const metaWidth = metaWidths[i % metaWidths.length];
            i++;

            return (
              <li
                key={i}
                className="mx-auto w-full max-w-(--page-width) px-3 sm:px-6"
              >
                <div className="flex items-start gap-3 border-t border-gray-200 py-2 [&:first-child]:border-t-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className="my-1 h-4 animate-pulse rounded-lg bg-gray-150"
                      style={{ inlineSize: width }}
                    />
                    {twoLine && (
                      <span
                        className="my-[.203125rem] h-[.8125rem] animate-pulse rounded-lg bg-gray-150"
                        style={{ inlineSize: metaWidth }}
                      />
                    )}
                  </div>
                  <span className="mt-1 h-4 w-16 animate-pulse rounded-lg bg-gray-150" />
                </div>
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}
