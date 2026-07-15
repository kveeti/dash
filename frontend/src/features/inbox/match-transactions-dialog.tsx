import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import {
  inboxMatchesQuery,
  matchInboxRows,
  type InboxMatch,
  type InboxRow,
} from "../../api/inbox";
import { Command } from "../../ui/combobox/command";
import { formatAmount } from "../transactions/transaction-row";

import styles from "./match-transactions-dialog.module.css";

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

function formatDate(value: string) {
  const date = new Date(value);
  return date.getFullYear() === new Date().getFullYear()
    ? shortDateFmt.format(date)
    : longDateFmt.format(date);
}

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
  const queryClient = useQueryClient();
  const match = useMutation(() => ({
    mutationFn: (matchId: string) => matchInboxRows(activeID(), matchId),
    onSuccess: () => {
      props.onClose();
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  }));

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
                      onSelect={() => match.mutate(row.id)}
                    >
                      <span class={styles.who}>
                        {row.counterparty || row.description || "—"}
                      </span>
                      <MatchAmount source={data().source} match={row} />
                      <span class={styles.meta}>
                        {row.kind === "exchange" ? "Exchange" : "Transfer"} ·{" "}
                        {formatDate(row.date)}
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
      <span class={styles.meta}>{formatDate(props.row.date)}</span>
      <span class={styles.account}>{props.row.account}</span>
    </section>
  );
}
