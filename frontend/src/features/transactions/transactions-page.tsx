import { A } from "@solidjs/router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, type Bucket } from "../../api/buckets";
import {
  deleteTransaction,
  transactionsQuery,
  type Transaction,
} from "../../api/transactions";
import {
  formatAmount,
  toTransactionRow,
  type TransactionRow,
} from "./transaction-row";

const asKind = <K extends TransactionRow["kind"]>(kind: K) => (
  row: TransactionRow,
) => (row.kind === kind ? (row as Extract<TransactionRow, { kind: K }>) : undefined);

import styles from "./transactions-page.module.css";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function groupByDate(txns: Transaction[]): { date: string; txns: Transaction[] }[] {
  const groups: { date: string; txns: Transaction[] }[] = [];
  for (const txn of txns) {
    const last = groups[groups.length - 1];
    if (last && last.date === txn.date) last.txns.push(txn);
    else groups.push({ date: txn.date, txns: [txn] });
  }
  return groups;
}

export default function TransactionsPage() {
  const transactions = useInfiniteQuery(transactionsQuery);
  const buckets = useQuery(bucketsQuery);
  const queryClient = useQueryClient();

  const allTxns = () =>
    transactions.data!.pages.flatMap((p) => p.transactions);

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

  return (
    <>
      <div style={{display:"flex", "justify-content":"space-between", "padding-inline": "1.5rem"}}>
        <h1 style={{"font-size":"1.2rem", "font-weight":"500"}}>Transactions</h1>

        <A href="/transactions/new">New expense</A>
      </div>

      <div style={{"background-color":"var(--gray-1)", height: "100%", padding: "var(--s5)", "border-radius": "var(--s3)", border: "1px solid var(--gray-3)"}}>
        <Switch>
          <Match when={transactions.isPending || buckets.isPending}>
            <p>loading…</p>
          </Match>
          <Match when={transactions.isError || buckets.isError}>
            <p>error: {(transactions.error ?? buckets.error)?.message}</p>
          </Match>
          <Match when={transactions.data && buckets.data}>
            <For
              each={groupByDate(allTxns())}
              fallback={<p>no transactions yet</p>}
            >
              {(group) => (
                <section class={styles.group}>
                  <div class={styles.date}>
                    {dateFormat.format(new Date(group.date))}
                  </div>
                  <ul class={styles.list}>
                    <For each={group.txns}>
                      {(txn) => (
                        <li class={styles.row}>
                          <Row txn={txn} buckets={bucketsById()} />
                          <button
                            type="button"
                            class={styles.delete}
                            onClick={() => onDelete(txn)}
                          >
                            delete
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
            <Show when={transactions.hasNextPage}>
              <button
                type="button"
                onClick={() => transactions.fetchNextPage()}
                disabled={transactions.isFetchingNextPage}
              >
                {transactions.isFetchingNextPage ? "loading…" : "Load older"}
              </button>
            </Show>
          </Match>
        </Switch>
      </div>
    </>
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
