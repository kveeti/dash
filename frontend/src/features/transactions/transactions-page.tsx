import { useSearchParams } from "@solidjs/router";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/solid-query";
import { createMemo, For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, useCreateBucket } from "../../api/buckets";
import {
  addTransactionTagMutation,
  bulkCategorizeMutation,
  tagsQuery,
  transactionsQuery,
  type Transaction,
} from "../../api/transactions";
import { formatAmount, formatListDate } from "../../lib/format";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Filterbar } from "../list-page/filterbar";
import { FloatingBar } from "../list-page/floating-bar";
import { createSelection } from "../list-page/selection";
import { toTransactionRow, type TransactionRow } from "./transaction-row";

import shell from "../list-page/list-page.module.css";
import styles from "./transactions-page.module.css";

const asKind =
  <K extends TransactionRow["kind"]>(kind: K) =>
  (row: TransactionRow) =>
    row.kind === kind
      ? (row as Extract<TransactionRow, { kind: K }>)
      : undefined;

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams<{ q?: string; tag?: string }>();

  const transactions = useInfiniteQuery(() =>
    transactionsQuery(params.q ?? "", params.tag ?? ""),
  );
  const buckets = useQuery(bucketsQuery);
  const tags = useQuery(() => tagsQuery());
  const createBucket = useCreateBucket();

  const allTxns = () => transactions.data!.pages.flatMap((p) => p.transactions);

  const {
    selectMode,
    setSelectMode,
    selected,
    toggle,
    clearSelection,
    exitSelect,
  } = createSelection();

  const categories = () =>
    buckets.data!.filter(
      (b) => (b.kind === "expense" || b.kind === "income") && !b.hidden,
    );

  const onCreate = (name: string) => createBucket({ kind: "expense", name });

  const categorize = useMutation(bulkCategorizeMutation);
  const tag = useMutation(addTransactionTagMutation);

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
              {(txn, i) => {
                const dateFormatted = formatListDate(txn.date);
                const prev = allTxns()[i() - 1];
                const showDateHeader =
                  !prev || formatListDate(prev.date) !== dateFormatted;

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
                            onFilterTag={(value) =>
                              setParams({ tag: value }, { replace: true })
                            }
                          />
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
              categorize.mutate(
                { ids: [...selected()], bucketId },
                { onSuccess: exitSelect },
              )
            }
            onCreate={onCreate}
            tags={tags.data!.tags}
            onTag={(value) =>
              tag.mutate(
                { ids: [...selected()], value },
                { onSuccess: exitSelect },
              )
            }
          />
        </Match>
      </Switch>
    </div>
  );
}

function Row(props: { txn: Transaction; onFilterTag: (tag: string) => void }) {
  const row = createMemo(() => toTransactionRow(props.txn));

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
