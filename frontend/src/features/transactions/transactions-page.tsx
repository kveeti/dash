import { Fragment } from "react";

import {
  useAddTransactionTagMutation,
  useBulkCategorizeMutation,
  useInfiniteTransactionsQuery,
  useTagsQuery,
  type Transaction,
} from "../../api/transactions";
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
import { TagCombobox } from "./tag-combobox";
import { toTransactionRow, type TransactionRow } from "./transaction-row";

import listShell from "../../lib/list-shell/list-shell.module.css";
import styles from "./transactions-page.module.css";

const asKind =
  <K extends TransactionRow["kind"]>(kind: K) =>
  (row: TransactionRow) =>
    row.kind === kind
      ? (row as Extract<TransactionRow, { kind: K }>)
      : undefined;

export default function TransactionsPage() {
  const searchQuery = useSearchParam("q");
  const tag = useSearchParam("tag");

  const setParam = (key: string, value: string | undefined) => {
    setSearchParam(key, value || undefined, { replace: true });
  };

  const selection = useSelection();
  const transactions = useInfiniteTransactionsQuery({
    searchQuery: searchQuery || undefined,
    tag: tag || undefined,
  });
  const txns =
    transactions.data?.pages.flatMap((page) => page.transactions) ?? [];
  const visibleIds = txns.map((txn) => txn.id);
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection.selected.has(id));

  return (
    <div className={listShell.wrapper}>
      <Filterbar
        selectLabel="Select transactions"
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
        onSearch={(value) => setParam("q", value)}
        tag={tag || undefined}
        onClearTag={() => setParam("tag", undefined)}
      />

      <List selection={selection} transactions={transactions} txns={txns} />

      <FloatingBar selection={selection} />
    </div>
  );
}

function List(props: {
  selection: UseSelectionReturn;
  transactions: ReturnType<typeof useInfiniteTransactionsQuery>;
  txns: Transaction[];
}) {
  const { f, isLoading: i18nLoading, isError: i18nError } = useI18n();

  if (props.transactions.isLoading || i18nLoading) {
    return <ListSkeleton twoLine />;
  }
  if (props.transactions.isError || i18nError) {
    return <p className={listShell.col}>error loading transactions</p>;
  }

  if (!props.txns.length) {
    return <p className={listShell.col}>no transactions yet</p>;
  }

  let prevDate: string | null = null;

  const filterDate = (date: string) => {
    const d = new Date(date);
    return new Date().getFullYear() === d.getFullYear()
      ? f.shortDate(d)
      : f.longDate(d);
  };

  return (
    <>
      <ul className={listShell.list}>
        {props.txns.map((txn) => {
          const dateFormatted = filterDate(txn.date);
          const showDateHeader = dateFormatted !== prevDate;
          prevDate = dateFormatted;

          return (
            <Fragment key={txn.id}>
              {showDateHeader && (
                <li role="presentation" className={listShell.datePos}>
                  <h2 className={listShell.date}>{dateFormatted}</h2>
                </li>
              )}

              <li className={listShell.col}>
                <div
                  className={`${listShell.rowWrap} ${props.selection.selectMode ? listShell.rowWrapSelect : ""}`}
                  onClick={() =>
                    props.selection.selectMode && props.selection.toggle(txn.id)
                  }
                >
                  <div className={listShell.checkSlot}>
                    <Checkbox
                      checked={props.selection.selected.has(txn.id)}
                      tabIndex={-1}
                      style={{ pointerEvents: "none" }}
                      readOnly
                    />
                  </div>
                  <div className={`${listShell.slide} ${styles.rowContent}`}>
                    <Row
                      txn={txn}
                      onFilterTag={(value) =>
                        setSearchParam("tag", value || undefined, {
                          replace: true,
                        })
                      }
                    />
                  </div>
                </div>
              </li>
            </Fragment>
          );
        })}
      </ul>

      {props.transactions.hasNextPage && (
        <button
          type="button"
          className={listShell.col}
          onClick={() => {
            if (!props.transactions.isFetchingNextPage)
              props.transactions.fetchNextPage();
          }}
        >
          {props.transactions.isFetchingNextPage ? "loading…" : "Load older"}
        </button>
      )}
    </>
  );
}

function Row(props: { txn: Transaction; onFilterTag: (tag: string) => void }) {
  const { f } = useI18n();
  const row = toTransactionRow(props.txn);

  const simple = asKind("simple")(row);
  if (simple) {
    const who = props.txn.counterparty || props.txn.description;
    return (
      <>
        <span className={styles.who}>{who}</span>
        <span
          className={`${styles.amount} ${simple.amount >= 0 ? styles.positive : ""}`}
        >
          {f.amount(simple.amount, simple.currency)}
        </span>
        <div className={styles.metaRow}>
          <span className={styles.meta}>
            {simple.category}
            <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
          </span>
          {simple.account && (
            <span className={styles.account}>{simple.account}</span>
          )}
        </div>
      </>
    );
  }

  const transfer = asKind("transfer")(row);
  if (transfer) {
    return (
      <>
        <span className={styles.who}>
          <span className={styles.swap} />
          {transfer.from} → {transfer.to}
        </span>
        <span className={`${styles.amount} ${styles.muted}`}>
          {f.amount(transfer.amount, transfer.currency)}
        </span>
        <span className={styles.meta}>
          Transfer
          <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
        </span>
      </>
    );
  }

  const exchange = asKind("exchange")(row);
  if (exchange) {
    return (
      <>
        <span className={styles.who}>
          <span className={styles.swap} />
          {exchange.from !== exchange.to
            ? `${exchange.from} → ${exchange.to}`
            : exchange.from}
        </span>
        <span className={`${styles.amount} ${styles.muted}`}>
          {f.amount(exchange.fromAmount, exchange.fromCurrency)} →{" "}
          {f.amount(exchange.toAmount, exchange.toCurrency)}
        </span>
        <span className={styles.meta}>
          Exchange
          <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
        </span>
      </>
    );
  }

  const generic = asKind("generic")(row)!;
  const who = props.txn.counterparty || props.txn.description || "Transaction";
  return (
    <>
      <span className={styles.who}>{who}</span>
      <span />
      <span className={styles.meta}>
        {generic.legs.map((leg, i) => (
          <Fragment key={i}>
            {i > 0 && ", "}
            {leg.name} {f.amount(leg.amount, leg.currency)}
          </Fragment>
        ))}
        <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
      </span>
    </>
  );
}

function TagList(props: { tags: string[]; onFilter: (tag: string) => void }) {
  return (
    <>
      {props.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className={styles.tag}
          onClick={() => props.onFilter(tag)}
        >
          #{tag}
        </button>
      ))}
    </>
  );
}

function FloatingBar(props: { selection: UseSelectionReturn }) {
  const tags = useTagsQuery();
  const categorize = useBulkCategorizeMutation();
  const addTag = useAddTransactionTagMutation();

  return (
    <FloatingBarWrap show={props.selection.selectMode}>
      <SelectionCountButton
        count={props.selection.selected.size}
        onClick={props.selection.clearSelection}
      />
      <div className={listShell.barPicker}>
        <BucketPicker
          kinds={["expense", "income"]}
          createKinds={["expense"]}
          value={null}
          placeholder="Categorize…"
          onPick={(bucket) => {
            if (categorize.isPending) return;
            categorize.mutate(
              { ids: [...props.selection.selected], bucketId: bucket.id },
              { onSuccess: props.selection.exitSelect },
            );
          }}
        />
      </div>
      <TagCombobox
        className={listShell.barPicker}
        tags={tags.data?.tags ?? []}
        onChange={(value) => {
          if (addTag.isPending) return;
          addTag.mutate(
            { ids: [...props.selection.selected], value },
            { onSuccess: props.selection.exitSelect },
          );
        }}
      />
      <CloseButton onClick={props.selection.exitSelect} />
    </FloatingBarWrap>
  );
}
