import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import {
  inboxMatchesQuery,
  matchInboxRowsMutation,
  type InboxMatch,
  type InboxRow,
} from "../../api/inbox";
import { formatAmount, formatListDate } from "../../lib/format";
import { Command } from "../../ui/combobox/command";

import styles from "./match-transactions-dialog.module.css";

export function MatchTransactionsDialog(props: {
  id?: string;
  onClose: () => void;
}) {
  const [id, setID] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [search, setSearch] = createSignal("");

  createEffect(() => {
    const value = query();
    const timeout = window.setTimeout(() => setSearch(value), 250);
    onCleanup(() => window.clearTimeout(timeout));
  });

  const activeID = () => props.id ?? id();
  const matches = useQuery(() => ({
    ...inboxMatchesQuery(activeID(), search()),
    enabled: Boolean(props.id),
  }));
  const match = useMutation(matchInboxRowsMutation);

  createEffect(() => {
    if (!props.id) return;
    setID(props.id);
    setQuery("");
    setSearch("");
    match.reset();
  });

  return (
    <Command.Dialog
      label="Match transactions"
      open={Boolean(props.id)}
      onOpenChange={(open) => !open && props.onClose()}
      shouldFilter={false}
      class={styles.command}
      contentClassName={styles.dialog}
    >
      <Show when={matches.isSuccess && matches.data}>
        {(data) => <Source row={data().source} />}
      </Show>

      <div class={styles.panel}>
        <div class={styles.inputWrap}>
          <Command.Input
            placeholder="Search possible matches"
            value={query()}
            onValueChange={setQuery}
          />
          <Show when={matches.isFetching}>
            <span class={styles.loading}>loading…</span>
          </Show>
        </div>
        <Show when={matches.isError}>
          <p class={styles.status}>{matches.error?.message}</p>
        </Show>
        <Show when={matches.isSuccess && matches.data}>
          {(data) => (
            <>
              <Command.List>
                <Command.Empty>No possible matches found.</Command.Empty>
                <For each={data().matches}>
                  {(row) => (
                    <Command.Item
                      class={`${styles.transactionRow} ${styles.matchRow}`}
                      value={row.id}
                      onSelect={() =>
                        match.mutate(
                          { id: activeID(), matchId: row.id },
                          { onSuccess: () => props.onClose() },
                        )
                      }
                    >
                      <span class={styles.who}>
                        {row.counterparty || row.description || "—"}
                      </span>
                      <MatchAmount source={data().source} match={row} />
                      <span class={styles.meta}>
                        {row.kind === "exchange" ? "Exchange" : "Transfer"} ·{" "}
                        {formatListDate(row.date)}
                      </span>
                      <span class={styles.account}>{row.account}</span>
                    </Command.Item>
                  )}
                </For>
              </Command.List>
              <Show when={match.isError}>
                <p class={styles.error}>{match.error?.message}</p>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Command.Dialog>
  );
}

function MatchAmount(props: { source: InboxRow; match: InboxMatch }) {
  const outgoing = () => (props.source.amount < 0 ? props.source : props.match);
  const incoming = () => (props.source.amount > 0 ? props.source : props.match);
  return (
    <Show
      when={props.match.kind === "exchange"}
      fallback={
        <span class={styles.amount}>
          {formatAmount(Math.abs(props.source.amount), props.source.currency)}
        </span>
      }
    >
      <span class={styles.amount}>
        {formatAmount(outgoing().amount, outgoing().currency)} →{" "}
        {formatAmount(incoming().amount, incoming().currency)}
      </span>
    </Show>
  );
}

function Source(props: { row: InboxRow }) {
  return (
    <section class={`${styles.source} ${styles.transactionRow}`}>
      <span class={styles.who}>
        {props.row.counterparty || props.row.description || "—"}
      </span>
      <span class={styles.amount}>
        {formatAmount(props.row.amount, props.row.currency)}
      </span>
      <span class={styles.meta}>{formatListDate(props.row.date)}</span>
      <span class={styles.account}>{props.row.account}</span>
    </section>
  );
}
