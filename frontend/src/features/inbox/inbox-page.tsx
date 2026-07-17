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
import { ListSkeleton } from "../../lib/list-shell/list-skeleton";
import {
  useSelection,
  type UseSelectionReturn,
} from "../../lib/list-shell/selection";
import { setSearchParam, useSearchParam } from "../../lib/search-param";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { BucketPicker } from "../buckets/bucket-picker";
import { useI18n } from "../i18n/use-i18n";
import { BucketComboRoot, BucketComboTrigger } from "./bucket-combo";
import { InboxUndoBar, InboxUndoProvider } from "./inbox-undo";
import { useInboxUndo } from "./inbox-undo-context";
import {
  MatchTransactions,
  useMatchTransactions,
} from "./match-transactions-dialog";

import listShell from "../../lib/list-shell/list-shell.module.css";
import styles from "./inbox-page.module.css";

export default function InboxPage() {
  const selection = useSelection();

  return (
    <InboxUndoProvider selection={selection}>
      <InboxPageContent selection={selection} />
    </InboxUndoProvider>
  );
}

function InboxPageContent(props: { selection: UseSelectionReturn }) {
  const searchQuery = useSearchParam("q");
  const selection = props.selection;
  const inboxQuery = useInfiniteInboxQuery({ searchQuery });
  const inboxItems = inboxQuery.data?.pages.flatMap((p) => p.rows) ?? [];
  const visibleIds = inboxItems.map((item) => item.id);
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection.selected.has(id));

  return (
    <div className={listShell.wrapper}>
      <Filterbar
        selectLabel="Select rows"
        selectMode={selection.selectMode}
        onSelectMode={(on) =>
          on ? selection.setSelectMode(true) : selection.exitSelect()
        }
        allVisibleSelected={allVisibleSelected}
        onToggleAll={() =>
          allVisibleSelected
            ? selection.drop(visibleIds)
            : selection.select(visibleIds)
        }
        search={searchQuery || undefined}
        onSearch={(value) => setSearchParam("q", value, { replace: true })}
      />

      <MatchTransactions>
        <List
          selection={selection}
          searchQuery={searchQuery}
          inboxQuery={inboxQuery}
          inboxItems={inboxItems}
          visibleIds={visibleIds}
        />
      </MatchTransactions>

      <FloatingBar selection={selection} />
      <InboxUndoBar hide={selection.selectMode} />
    </div>
  );
}

function List(props: {
  selection: UseSelectionReturn;
  searchQuery: string | null;
  inboxQuery: ReturnType<typeof useInfiniteInboxQuery>;
  inboxItems: InboxItem[];
  visibleIds: string[];
}) {
  const { f, isLoading: i18nLoading, isError: i18nError } = useI18n();
  const matchContext = useMatchTransactions();

  if (props.inboxQuery.isLoading || i18nLoading) {
    return <ListSkeleton />;
  }
  if (props.inboxQuery.isError || i18nError) {
    return <p className={listShell.col}>error loading inbox</p>;
  }

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
      {props.inboxItems.length ? (
        <ul
          className={`${listShell.list} ${props.selection.selectMode ? listShell.listSelect : ""}`}
        >
          {props.inboxItems.map((item) => {
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

                <Item
                  item={item}
                  selection={props.selection}
                  visibleIds={props.visibleIds}
                />
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

function Item(props: {
  item: InboxItem;
  selection: UseSelectionReturn;
  visibleIds: string[];
}) {
  const itemId = props.item.id;
  const { f } = useI18n();

  return (
    <li className={listShell.col}>
      <div
        className={`${listShell.rowWrap} ${props.selection.selectMode ? listShell.rowWrapSelect : ""}`}
        onClick={(event) => {
          if (!props.selection.selectMode) return;
          if (event.shiftKey)
            props.selection.selectThrough(itemId, props.visibleIds);
          else props.selection.toggle(itemId);
        }}
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
            <span className={styles.primary}>
              {props.item.counterparty || "—"}
            </span>
            <span
              className={`${styles.amount} ${props.item.amount >= 0 ? styles.positive : ""}`}
            >
              {f.amount(props.item.amount, props.item.currency)}
            </span>
            <span className={styles.secondary}>{props.item.description}</span>
            <span className={styles.account}>{props.item.account}</span>
          </BucketComboTrigger>
        </div>
      </div>
    </li>
  );
}

function FloatingBar(props: { selection: UseSelectionReturn }) {
  const categorize = useCategorizeInboxMutation();
  const undo = useInboxUndo();

  return (
    <FloatingBarWrap show={props.selection.selectMode}>
      <SelectionCountButton
        count={props.selection.selected.size}
        onClick={props.selection.clearSelection}
      />
      <div className={listShell.barPicker}>
        <BucketPicker
          kinds={["expense", "income", "person"]}
          createKinds={["expense", "income", "person"]}
          value={null}
          placeholder="Category or person"
          onPick={(bucket) => {
            const ids = [...props.selection.selected];
            void undo.run(
              ids,
              `Categorized ${ids.length} transaction${ids.length === 1 ? "" : "s"}`,
              () =>
                categorize.mutateAsync({
                  rowIds: ids,
                  target: { type: "bucket", bucketId: bucket.id },
                }),
            );
            props.selection.exitSelect();
          }}
        />
      </div>
      <CloseButton onClick={props.selection.exitSelect} />
    </FloatingBarWrap>
  );
}
