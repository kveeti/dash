import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import {
  matchInboxTransfer,
  transferMatchesQuery,
  type InboxRow,
} from "../../api/inbox";
import { Command } from "../../ui/combobox/command";
import { formatAmount } from "../transactions/transaction-row";

import styles from "./match-transfer-page.module.css";

export default function MatchTransferPage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams<{ q?: string }>();
  const [query, setQuery] = createSignal(search.q ?? "");
  createEffect(() => {
    const value = query();
    const timeout = window.setTimeout(
      () => setSearch({ q: value || undefined }, { replace: true }),
      250,
    );
    onCleanup(() => window.clearTimeout(timeout));
  });

  const matches = useQuery(() =>
    transferMatchesQuery(params.id, search.q ?? ""),
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const match = useMutation(() => ({
    mutationFn: (matchId: string) => matchInboxTransfer(params.id, matchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      navigate("/inbox");
    },
  }));

  return (
    <main class={styles.page}>
      <h1>Match transfer</h1>
      <Show when={matches.data} fallback={<p>loading…</p>}>
        <Source row={matches.data!.source} />
        <Command shouldFilter={false} class={styles.command}>
          <Command.Input
            placeholder="Search possible matches"
            value={query()}
            onValueChange={setQuery}
          />
          <Command.List>
            <Command.Empty>No possible transfers found.</Command.Empty>
            <For each={matches.data!.matches}>
              {(row) => (
                <Command.Item
                  value={row.id}
                  onSelect={() => match.mutate(row.id)}
                >
                  <span class={styles.info}>
                    <strong>{row.account}</strong>
                    <span>{row.counterparty || row.description || "—"}</span>
                  </span>
                  <span>{formatAmount(row.amount, row.currency)}</span>
                </Command.Item>
              )}
            </For>
          </Command.List>
        </Command>
        <Show when={match.isError}>
          <p>{match.error?.message}</p>
        </Show>
      </Show>
    </main>
  );
}

function Source(props: { row: InboxRow }) {
  return (
    <section class={styles.source}>
      <span class={styles.info}>
        <strong>
          {props.row.counterparty || props.row.description || "—"}
        </strong>
        <span>{props.row.account}</span>
      </span>
      <strong>{formatAmount(props.row.amount, props.row.currency)}</strong>
    </section>
  );
}
