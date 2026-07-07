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
  bulkCategorize,
  deleteTransaction,
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
  const [params, setParams] = useSearchParams<{ q?: string }>();

  const transactions = useInfiniteQuery(() =>
    transactionsQuery(params.q ?? ""),
  );
  const buckets = useQuery(bucketsQuery);
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
      />

      <Switch>
        <Match when={transactions.isPending || buckets.isPending}>
          <p class={shell.col}>loading…</p>
        </Match>
        <Match when={transactions.isError || buckets.isError}>
          <p class={shell.col}>
            error: {(transactions.error ?? buckets.error)?.message}
          </p>
        </Match>
        <Match when={transactions.data && buckets.data}>
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
                      <Show
                        when={selectMode()}
                        fallback={
                          <div class={styles.row}>
                            <Row txn={txn} buckets={bucketsById()} />
                            <button
                              type="button"
                              class={styles.delete}
                              onClick={() => onDelete(txn)}
                            >
                              delete
                            </button>
                          </div>
                        }
                      >
                        <div
                          class={shell.selectable}
                          onClick={() => toggle(txn.id)}
                        >
                          <Checkbox
                            checked={selected().has(txn.id)}
                            tabindex={-1}
                            style={{ "pointer-events": "none" }}
                          />
                          <Row txn={txn} buckets={bucketsById()} />
                        </div>
                      </Show>
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

          <Show when={selectMode()}>
            <FloatingBar
              count={selected().size}
              categories={categories()}
              onClear={clearSelection}
              onExit={exitSelect}
              onCategorize={(bucketId) =>
                categorize.mutate({ ids: [...selected()], bucketId })
              }
              onCreate={onCreate}
            />
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

function Row(props: { txn: Transaction; buckets: Map<string, Bucket> }) {
  const row = () => toTransactionRow(props.txn, props.buckets);

  return (
    <Switch>
      <Match when={asKind("simple")(row())}>
        {(r) => (
          <>
            <span class={styles.primary}>
              {r().category}
              <Show when={props.txn.counterparty}>
                {" "}
                <span class={styles.secondary}>{props.txn.counterparty}</span>
              </Show>
              <Show when={props.txn.description}>
                {" "}
                <span class={styles.secondary}>{props.txn.description}</span>
              </Show>
              <Show when={r().account}>
                {" "}
                <span class={styles.secondary}>· {r().account}</span>
              </Show>
            </span>
            <span
              class={styles.amount}
              classList={{ [styles.positive]: r().amount >= 0 }}
            >
              {formatAmount(r().amount, r().currency)}
            </span>
          </>
        )}
      </Match>
      <Match when={asKind("transfer")(row())}>
        {(r) => (
          <>
            <span class={styles.primary}>
              Transfer{" "}
              <span class={styles.secondary}>
                {r().from} → {r().to}
              </span>
            </span>
            <span class={styles.amount}>
              {formatAmount(r().amount, r().currency)}
            </span>
          </>
        )}
      </Match>
      <Match when={asKind("generic")(row())}>
        {(r) => (
          <span class={styles.primary}>
            <Show when={props.txn.description}>{props.txn.description} </Show>
            <span class={styles.secondary}>
              <For each={r().legs}>
                {(leg, i) => (
                  <>
                    <Show when={i() > 0}>, </Show>
                    {leg.name} {formatAmount(leg.amount, leg.currency)}
                  </>
                )}
              </For>
            </span>
          </span>
        )}
      </Match>
    </Switch>
  );
}
