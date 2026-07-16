import { Fragment } from "react";

import listShell from "./list-shell.module.css";

const groups = [3, 1, 4, 2, 3, 5, 2, 1, 4, 3, 2, 6, 1, 3, 2];
const widths = ["9rem", "13rem", "7rem", "11rem", "10rem", "8rem"];
const metaWidths = ["5rem", "7rem", "4rem", "6rem", "5.5rem"];

export function ListSkeleton({ twoLine = false }: { twoLine?: boolean }) {
  let i = 0;
  return (
    <ul
      className={`${listShell.list} ${listShell.skeletonList}`}
      aria-hidden="true"
    >
      {groups.map((count, g) => (
        <Fragment key={g}>
          <li role="presentation" className={listShell.datePos}>
            <span className={listShell.skeletonDate} />
          </li>
          {Array.from({ length: count }, () => {
            const width = widths[i % widths.length];
            const metaWidth = metaWidths[i % metaWidths.length];
            i++;
            return (
              <li key={i} className={listShell.col}>
                <div className={listShell.skeletonRow}>
                  <div className={listShell.skeletonLines}>
                    <span
                      className={`${listShell.skeletonBar} ${listShell.skeletonText}`}
                      style={{ inlineSize: width }}
                    />
                    {twoLine && (
                      <span
                        className={`${listShell.skeletonBar} ${listShell.skeletonMeta}`}
                        style={{ inlineSize: metaWidth }}
                      />
                    )}
                  </div>
                  <span
                    className={`${listShell.skeletonBar} ${listShell.skeletonAmount}`}
                  />
                </div>
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}
