import { useSearchParams } from "@solidjs/router";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, useCreateBucket } from "../../api/buckets";
import {
  categorizeInboxMutation,
  inboxQuery,
  type InboxRow,
} from "../../api/inbox";
import { formatAmount, formatListDate } from "../../lib/format";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Combobox } from "../../ui/combobox/combobox";
import { Filterbar } from "../list-page/filterbar";
import { FloatingBar } from "../list-page/floating-bar";
import { createSelection } from "../list-page/selection";
import { CategoryMenu } from "../transactions/bucket-combobox";
import { MatchTransactionsDialog } from "./match-transactions-dialog";

import shell from "../list-page/list-page.module.css";
import styles from "./inbox-page.module.css";

export default function InboxPage() {
  const [params, setParams] = useSearchParams<{
    q?: string;
    match?: string;
  }>();
  const openMatch = (id: string) => {
    setParams({ match: id }, { scroll: false });
  };

  const closeMatch = () => {
    setParams({ match: undefined }, { replace: true, scroll: false });
  };

  const inbox = useInfiniteQuery(() => inboxQuery(params.q ?? ""));
  const buckets = useQuery(bucketsQuery);
  const createBucket = useCreateBucket();

  const items = () => inbox.data!.pages.flatMap((p) => p.rows);

  const categoriesAndPeople = () =>
    buckets.data!.filter(
      (b) =>
        (b.kind === "expense" || b.kind === "income" || b.kind === "person") &&
        !b.hidden,
    );

  const onCreate = (kind: "expense" | "person") => (name: string) =>
    createBucket({ kind, name });

  const {
    selectMode,
    setSelectMode,
    selected,
    toggle,
    clearSelection,
    exitSelect,
    drop,
  } = createSelection();

  const categorize = useMutation(categorizeInboxMutation);

  return (
    <div class={shell.wrapper}>
      <Filterbar
        selectLabel="Select rows"
        selectMode={selectMode()}
        onSelectMode={(on) => (on ? setSelectMode(true) : exitSelect())}
        search={params.q ?? ""}
        onSearch={(value) => setParams({ q: value }, { replace: true })}
      />

      <Switch>
        <Match when={inbox.isPending || buckets.isPending}>
          <p class={shell.col}>loading…</p>
        </Match>

        <Match when={inbox.isError || buckets.isError}>
          <p class={shell.col}>
            error: {(inbox.error ?? buckets.error)?.message}
          </p>
        </Match>

        <Match when={inbox.data && buckets.data}>
          <ul class={shell.list}>
            <For
              each={items()}
              fallback={
                <p class={shell.col}>
                  {params.q ? "no results" : "nothing to categorize 🎉"}
                </p>
              }
            >
              {(row, i) => {
                const dateFormatted = formatListDate(row.date);
                const prev = items()[i() - 1];
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
                        onClick={() => selectMode() && toggle(row.id)}
                      >
                        <div class={shell.checkSlot}>
                          <Checkbox
                            checked={selected().has(row.id)}
                            tabindex={-1}
                            style={{ "pointer-events": "none" }}
                          />
                        </div>
                        <div class={`${shell.slide} ${styles.rowContent}`}>
                          <Combobox>
                            <Combobox.Trigger class={styles.rowTrigger}>
                              <Info row={row} />
                              <Amount row={row} />
                            </Combobox.Trigger>
                            <Combobox.Content>
                              <CategoryMenu
                                buckets={categoriesAndPeople()}
                                onChange={(bucketId) =>
                                  categorize.mutate(
                                    { ids: [row.id], bucketId },
                                    { onSuccess: () => drop([row.id]) },
                                  )
                                }
                                onCreate={onCreate("expense")}
                                onCreatePerson={onCreate("person")}
                                onMatchTransactions={() => openMatch(row.id)}
                                searchPlaceholder="Category, person, or action"
                              />
                            </Combobox.Content>
                          </Combobox>
                        </div>
                      </div>
                    </li>
                  </>
                );
              }}
            </For>
          </ul>

          <Show when={inbox.hasNextPage}>
            <button
              type="button"
              class={shell.col}
              onClick={() => inbox.fetchNextPage()}
              disabled={inbox.isFetchingNextPage}
            >
              {inbox.isFetchingNextPage ? "loading…" : "Load more"}
            </button>
          </Show>

          <FloatingBar
            show={selectMode()}
            count={selected().size}
            categories={categoriesAndPeople()}
            onClear={clearSelection}
            onExit={exitSelect}
            onCategorize={(bucketId) => {
              const ids = [...selected()];
              categorize.mutate(
                { ids, bucketId },
                { onSuccess: () => drop(ids) },
              );
            }}
            onCreate={onCreate("expense")}
            onCreatePerson={onCreate("person")}
          />
        </Match>
      </Switch>

      <MatchTransactionsDialog id={params.match} onClose={closeMatch} />
    </div>
  );
}

function Info(props: { row: InboxRow }) {
  return (
    <div class={styles.info}>
      <span class={styles.primary}>
        {props.row.counterparty || props.row.description || "—"}
        <Show when={props.row.counterparty && props.row.description}>
          {" "}
          <span class={styles.secondary}>{props.row.description}</span>
        </Show>
      </span>
    </div>
  );
}

function Amount(props: { row: InboxRow }) {
  return (
    <span
      class={styles.amount}
      classList={{ [styles.positive]: props.row.amount >= 0 }}
    >
      {formatAmount(props.row.amount, props.row.currency)}
    </span>
  );
}
