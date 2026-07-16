import { Fragment, useState } from "react";
import { useSearchParams } from "wouter";

import { useInfiniteInboxQuery, type InboxItem } from "../../api/inbox";
import { useI18n } from "../i18n/use-i18n";
import { BucketComboRoot, BucketComboTrigger } from "./bucket-combo";
import { MatchTransactions } from "./match-transactions-dialog";

import listShellStyles from "../../lib/list-shell/list-shell.module.css";
import styles from "./inbox-page.module.css";

export default function InboxPage() {
  const [params] = useSearchParams();
  const searchQuery = params.get("q");

  return <InboxList searchQuery={searchQuery} />;
}

function InboxList(props: { searchQuery: string | null }) {
  const { f } = useI18n();
  const selection = useSelection();
  const [params, setParams] = useSearchParams();

  const openMatch = (rowId: string) => {
    const next = new URLSearchParams(params);
    next.set("match", rowId);
    setParams(next);
  };

  const inboxQuery = useInfiniteInboxQuery({ searchQuery: props.searchQuery });
  if (inboxQuery.isLoading) {
    return "loading...";
  } else if (inboxQuery.isError) {
    return "Error loading inbox";
  }

  const inboxItems = inboxQuery.data?.pages.flatMap((p) => p.rows) ?? [];

  let prevFormattedDate: string | null = null;
  const currentYear = new Date().getFullYear();

  // The empty state stays inside BucketComboRoot: unmounting it would kill the
  // popup's close animation when the last row is categorized away.
  if (!inboxItems.length) {
    return (
      <>
        <BucketComboRoot onMatchAction={openMatch}>
          {props.searchQuery ? "no results" : "nothing to categorize"}
        </BucketComboRoot>
        <MatchTransactions />
      </>
    );
  }

  return (
    <BucketComboRoot onMatchAction={openMatch}>
      <MatchTransactions />
      <ul className={listShellStyles.list}>
        {inboxItems.map((item) => {
          const date = new Date(item.date);
          const isCurrentYear = currentYear === date.getFullYear();
          const dateFormatted = isCurrentYear
            ? f.shortDate(date)
            : f.longDate(date);
          const showDateHeader = dateFormatted !== prevFormattedDate;
          prevFormattedDate = dateFormatted;

          return (
            <Fragment key={item.id}>
              {showDateHeader && (
                <li role="presentation" className={listShellStyles.datePos}>
                  <h2 className={listShellStyles.date}>{dateFormatted}</h2>
                </li>
              )}

              <Item item={item} selection={selection} />
            </Fragment>
          );
        })}
      </ul>
    </BucketComboRoot>
  );
}

function Item(props: { item: InboxItem; selection: UseSelection }) {
  const itemId = props.item.id;
  const { f } = useI18n();

  return (
    <li className={listShellStyles.col}>
      <div
        className={`${listShellStyles.rowWrap}${props.selection.isSelecting ? listShellStyles.rowWrapSelect : ""}`}
        onClick={() =>
          props.selection.isSelecting && props.selection.toggle(itemId)
        }
      >
        <div className={listShellStyles.checkSlot}>
          {/* <Checkbox */}
          {/*   checked={props.selection.has(itemId)} */}
          {/*   tabindex={-1} */}
          {/*   style={{ "pointer-events": "none" }} */}
          {/* /> */}
        </div>
        <div className={`${listShellStyles.slide} ${styles.rowContent}`}>
          <BucketComboTrigger rowId={itemId} className={styles.rowTrigger}>
            <div className={styles.info}>
              <span className={styles.primary}>
                {props.item.counterparty || props.item.description || "—"}
                {props.item.counterparty && props.item.description && (
                  <>
                    {" "}
                    <span className={styles.secondary}>
                      {props.item.description}
                    </span>
                  </>
                )}
              </span>
            </div>
            <span
              className={`${styles.amount}${props.item.amount >= 0 ? styles.positive : ""}`}
            >
              {f.amount(props.item.amount, props.item.currency)}
            </span>
          </BucketComboTrigger>
        </div>
      </div>
    </li>
  );
}

function useSelection() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set<string>());

  const clearSelection = () => setSelectedRows(new Set<string>());

  const exitSelect = () => {
    setIsEnabled(false);
    clearSelection();
  };

  const toggle = (id: string) =>
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const drop = (ids: string[]) =>
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

  const has = selectedRows.has;

  return {
    isSelecting: isEnabled,
    rows: selectedRows,
    has,
    toggle,
    clearSelection,
    exitSelect,
    drop,
  };
}

type UseSelection = ReturnType<typeof useSelection>;
