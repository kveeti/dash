import { useSearchParams } from "@solidjs/router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { createSignal, For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, createBucket, type Bucket } from "../../api/buckets";
import {
  addTransactionTag,
  bulkCategorize,
  deleteTransaction,
  tagsQuery,
  transactionsQuery,
  type Transaction,
} from "../../api/transactions";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Filterbar } from "../list-page/filterbar";
import { FloatingBar } from "../list-page/floating-bar";
import {
  formatAmount,
  toTransactionRow,
  type TransactionRow,
} from "./transaction-row";

import shell from "../list-page/list-page.module.css";
import styles from "./transactions-page.module.css";

const asKind =
  <K extends TransactionRow["kind"]>(kind: K) =>
  (row: TransactionRow) =>
    row.kind === kind
      ? (row as Extract<TransactionRow, { kind: K }>)
      : undefined;

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const longDateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams<{ q?: string; tag?: string }>();

  const transactions = useInfiniteQuery(() =>
    transactionsQuery(params.q ?? "", params.tag ?? ""),
  );
  const buckets = useQuery(bucketsQuery);
  const tags = useQuery(() => tagsQuery());
  const queryClient = useQueryClient();

  const allTxns = () => transactions.data!.pages.flatMap((p) => p.transactions);

  const bucketsById = () =>
    new Map(buckets.data!.map((b) => [b.id, b] as [string, Bucket]));

  const mutation = useMutation(() => ({
    mutationFn: deleteTransaction,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  }));

  const onDelete = (txn: Transaction) => {
    if (window.confirm("Delete this transaction?")) mutation.mutate(txn.id);
  };

  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());

  const clearSelection = () => setSelected(new Set<string>());

  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const categories = () =>
    buckets.data!.filter(
      (b) => (b.kind === "expense" || b.kind === "income") && !b.hidden,
    );

  const onCreate = async (name: string) => {
    const bucket = await createBucket({ kind: "expense", name });
    await queryClient.invalidateQueries({ queryKey: ["buckets"] });
    return bucket;
  };

  const categorize = useMutation(() => ({
    mutationFn: ({ ids, bucketId }: { ids: string[]; bucketId: string }) =>
      bulkCategorize(ids, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      exitSelect();
    },
  }));

  const tag = useMutation(() => ({
    mutationFn: ({ ids, value }: { ids: string[]; value: string }) =>
      addTransactionTag(ids, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      exitSelect();
    },
  }));

  const thisYear = new Date().getFullYear();
  let prevDateFormatted: string | null = null;

  return (
    <div class={shell.wrapper}>
      <Filterbar
        selectLabel="Select transactions"
        selectMode={selectMode()}
        onSelectMode={(on) => (on ? setSelectMode(true) : exitSelect())}
        search={params.q ?? ""}
        onSearch={(value) => setParams({ q: value }, { replace: true })}
        tag={params.tag}
        onClearTag={() => setParams({ tag: undefined }, { replace: true })}
      />

      <Switch>
        <Match
          when={transactions.isPending || buckets.isPending || tags.isPending}
        >
          <p class={shell.col}>loading…</p>
        </Match>
        <Match when={transactions.isError || buckets.isError || tags.isError}>
          <p class={shell.col}>
            error:{" "}
            {(transactions.error ?? buckets.error ?? tags.error)?.message}
          </p>
        </Match>
        <Match when={transactions.data && buckets.data && tags.data}>
          <ul class={shell.list}>
            <For
              each={allTxns()}
              fallback={<p class={shell.col}>no transactions yet</p>}
            >
              {(txn) => {
                const dateConverted = new Date(txn.date);
                const showYear = dateConverted.getFullYear() !== thisYear;
                const dateFormatted = showYear
                  ? longDateFmt.format(dateConverted)
                  : shortDateFmt.format(dateConverted);
                const showDateHeader = dateFormatted !== prevDateFormatted;
                prevDateFormatted = dateFormatted;

                return (
                  <>
                    <Show when={showDateHeader}>
                      <li role="presentation" class={shell.datePos}>
                        <h2 class={shell.date}>{dateFormatted}</h2>
                      </li>
                    </Show>

                    <li class={shell.col}>
                      <div
                        class={shell.rowWrap}
                        classList={{ [shell.rowWrapSelect]: selectMode() }}
                        onClick={() => selectMode() && toggle(txn.id)}
                      >
                        <div class={shell.checkSlot}>
                          <Checkbox
                            checked={selected().has(txn.id)}
                            tabindex={-1}
                            style={{ "pointer-events": "none" }}
                          />
                        </div>
                        <div class={`${shell.slide} ${styles.rowContent}`}>
                          <Row
                            txn={txn}
                            buckets={bucketsById()}
                            onFilterTag={(value) =>
                              setParams({ tag: value }, { replace: true })
                            }
                          />
                          {/* <Show when={!selectMode()}> */}
                          {/*   <button */}
                          {/*     type="button" */}
                          {/*     class={styles.delete} */}
                          {/*     onClick={() => onDelete(txn)} */}
                          {/*   > */}
                          {/*     delete */}
                          {/*   </button> */}
                          {/* </Show> */}
                        </div>
                      </div>
                    </li>
                  </>
                );
              }}
            </For>
          </ul>

          <Show when={transactions.hasNextPage}>
            <button
              type="button"
              class={shell.col}
              onClick={() => transactions.fetchNextPage()}
              disabled={transactions.isFetchingNextPage}
            >
              {transactions.isFetchingNextPage ? "loading…" : "Load older"}
            </button>
          </Show>

          <FloatingBar
            show={selectMode()}
            count={selected().size}
            categories={categories()}
            onClear={clearSelection}
            onExit={exitSelect}
            onCategorize={(bucketId) =>
              categorize.mutate({ ids: [...selected()], bucketId })
            }
            onCreate={onCreate}
            tags={tags.data!.tags}
            onTag={(value) => tag.mutate({ ids: [...selected()], value })}
          />
        </Match>
      </Switch>
    </div>
  );
}

function Row(props: {
  txn: Transaction;
  buckets: Map<string, Bucket>;
  onFilterTag: (tag: string) => void;
}) {
  const row = () => toTransactionRow(props.txn, props.buckets);

  return (
    <Switch>
      <Match when={asKind("simple")(row())}>
        {(r) => {
          const who = () => props.txn.counterparty || props.txn.description;
          return (
            <>
              <span class={styles.who}>{who()}</span>
              <span
                class={styles.amount}
                classList={{ [styles.positive]: r().amount >= 0 }}
              >
                {formatAmount(r().amount, r().currency)}
              </span>
              <div class={styles.metaRow}>
                <span class={styles.meta}>
                  {r().category}
                  <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
                </span>
                <Show when={r().account}>
                  <span class={styles.account}>{r().account}</span>
                </Show>
              </div>
            </>
          );
        }}
      </Match>
      <Match when={asKind("transfer")(row())}>
        {(r) => (
          <>
            <span class={styles.who}>
              <span class={styles.swap} />
              {r().from} → {r().to}
            </span>
            <span class={`${styles.amount} ${styles.muted}`}>
              {formatAmount(r().amount, r().currency)}
            </span>
            <span class={styles.meta}>
              Transfer
              <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
            </span>
          </>
        )}
      </Match>
      <Match when={asKind("exchange")(row())}>
        {(r) => (
          <>
            <span class={styles.who}>
              <span class={styles.swap} />
              <Show when={r().from !== r().to} fallback={r().from}>
                {r().from} → {r().to}
              </Show>
            </span>
            <span class={`${styles.amount} ${styles.muted}`}>
              {formatAmount(r().fromAmount, r().fromCurrency)} →{" "}
              {formatAmount(r().toAmount, r().toCurrency)}
            </span>
            <span class={styles.meta}>
              Exchange
              <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
            </span>
          </>
        )}
      </Match>
      <Match when={asKind("generic")(row())}>
        {(r) => {
          const who = () =>
            props.txn.counterparty || props.txn.description || "Transaction";
          return (
            <>
              <span class={styles.who}>{who()}</span>
              <span />
              <span class={styles.meta}>
                <For each={r().legs}>
                  {(leg, i) => (
                    <>
                      <Show when={i() > 0}>, </Show>
                      {leg.name} {formatAmount(leg.amount, leg.currency)}
                    </>
                  )}
                </For>
                <TagList tags={props.txn.tags} onFilter={props.onFilterTag} />
              </span>
            </>
          );
        }}
      </Match>
    </Switch>
  );
}

function TagList(props: { tags: string[]; onFilter: (tag: string) => void }) {
  return (
    <For each={props.tags}>
      {(tag) => (
        <button
          type="button"
          class={styles.tag}
          onClick={() => props.onFilter(tag)}
        >
          #{tag}
        </button>
      )}
    </For>
  );
}
