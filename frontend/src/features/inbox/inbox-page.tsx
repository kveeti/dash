import { Fragment } from "react";

import {
  useCategorizeInboxMutation,
  useInfiniteInboxQuery,
  type InboxItem,
} from "../../api/inbox";
import { Filterbar } from "../../lib/list-shell/filterbar";
import {
  CloseButton,
  FloatingBarWrap,
  SelectionCountButton,
} from "../../lib/list-shell/floating-bar";
import {
  useSelection,
  type UseSelectionReturn,
} from "../../lib/list-shell/selection";
import { setSearchParam, useSearchParam } from "../../lib/search-param";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { BucketPicker } from "../buckets/bucket-picker";
import { useI18n } from "../i18n/use-i18n";
import { BucketComboRoot, BucketComboTrigger } from "./bucket-combo";
import {
  MatchTransactions,
  useMatchTransactions,
} from "./match-transactions-dialog";

import listShell from "../../lib/list-shell/list-shell.module.css";
import styles from "./inbox-page.module.css";

export default function InboxPage() {
  const searchQuery = useSearchParam("q");
  const selection = useSelection();

  return (
    <div className={listShell.wrapper}>
      <Filterbar
        selectLabel="Select rows"
        selectMode={selection.selectMode}
        onSelectMode={(on) =>
          on ? selection.setSelectMode(true) : selection.exitSelect()
        }
        search={searchQuery || undefined}
        onSearch={(value) => setSearchParam("q", value, { replace: true })}
      />

      <MatchTransactions>
        <List selection={selection} searchQuery={searchQuery} />
      </MatchTransactions>

      <FloatingBar selection={selection} />
    </div>
  );
}

function List(props: {
  selection: UseSelectionReturn;
  searchQuery: string | null;
}) {
  const { f } = useI18n();
  const matchContext = useMatchTransactions();

  const inboxQuery = useInfiniteInboxQuery({ searchQuery: props.searchQuery });

  if (inboxQuery.isLoading) {
    return <p className={listShell.col}>loading…</p>;
  }
  if (inboxQuery.isError) {
    return <p className={listShell.col}>error loading inbox</p>;
  }

  const inboxItems = inboxQuery.data?.pages.flatMap((p) => p.rows) ?? [];

  let prevDate: string | null = null;

  const currentYear = new Date().getFullYear();
  const formatDate = (value: string) => {
    const date = new Date(value);
    return currentYear === date.getFullYear()
      ? f.shortDate(date)
      : f.longDate(date);
  };

  return (
    <BucketComboRoot onMatchAction={matchContext.openMatchingTo}>
      {inboxItems?.length ? (
        <ul className={listShell.list}>
          {inboxItems.map((item) => {
            const dateFormatted = formatDate(item.date);
            const showDateHeader = dateFormatted !== prevDate;
            prevDate = dateFormatted;

            return (
              <Fragment key={item.id}>
                {showDateHeader && (
                  <li role="presentation" className={listShell.datePos}>
                    <h2 className={listShell.date}>{dateFormatted}</h2>
                  </li>
                )}

                <Item item={item} selection={props.selection} />
              </Fragment>
            );
          })}
        </ul>
      ) : (
        <p className={listShell.col}>
          {props.searchQuery ? "no results" : "nothing to categorize"}
        </p>
      )}
    </BucketComboRoot>
  );
}

function Item(props: { item: InboxItem; selection: UseSelectionReturn }) {
  const itemId = props.item.id;
  const { f } = useI18n();

  return (
    <li className={listShell.col}>
      <div
        className={`${listShell.rowWrap} ${props.selection.selectMode ? listShell.rowWrapSelect : ""}`}
        onClick={() =>
          props.selection.selectMode && props.selection.toggle(itemId)
        }
      >
        <div className={listShell.checkSlot}>
          <Checkbox
            checked={props.selection.selected.has(itemId)}
            tabIndex={-1}
            style={{ pointerEvents: "none" }}
            readOnly
          />
        </div>
        <div className={`${listShell.slide} ${styles.rowContent}`}>
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

function FloatingBar(props: { selection: UseSelectionReturn }) {
  const categorize = useCategorizeInboxMutation();

  return (
    <FloatingBarWrap show={props.selection.selectMode}>
      <SelectionCountButton
        count={props.selection.selected.size}
        onClick={props.selection.clearSelection}
      />
      <div className={listShell.barPicker}>
        <BucketPicker
          kinds={["expense", "income", "person"]}
          createKinds={["expense", "person"]}
          value={null}
          placeholder="Category or person"
          onPick={(bucket) => {
            const ids = [...props.selection.selected];
            categorize.mutate({
              rowIds: ids,
              target: { type: "bucket", bucketId: bucket.id },
            });
            props.selection.drop(ids);
          }}
        />
      </div>
      <CloseButton onClick={props.selection.exitSelect} />
    </FloatingBarWrap>
  );
}
