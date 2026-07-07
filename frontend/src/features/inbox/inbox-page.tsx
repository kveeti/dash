import { useSearchParams } from "@solidjs/router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { createSignal, For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, createBucket } from "../../api/buckets";
import { categorizeInbox, inboxQuery, type InboxRow } from "../../api/inbox";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Combobox } from "../../ui/combobox/combobox";
import { Filterbar } from "../list-page/filterbar";
import { FloatingBar } from "../list-page/floating-bar";
import { CategoryMenu } from "../transactions/bucket-combobox";
import { formatAmount } from "../transactions/transaction-row";

import shell from "../list-page/list-page.module.css";
import styles from "./inbox-page.module.css";

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

export default function InboxPage() {
  const [params, setParams] = useSearchParams<{ q?: string }>();

  const inbox = useInfiniteQuery(() => inboxQuery(params.q ?? ""));
  const buckets = useQuery(bucketsQuery);
  const queryClient = useQueryClient();

  const items = () => inbox.data!.pages.flatMap((p) => p.rows);

  const categories = () =>
    buckets.data!.filter(
      (b) => (b.kind === "expense" || b.kind === "income") && !b.hidden,
    );

  const onCreate = async (name: string) => {
    const bucket = await createBucket({ kind: "expense", name });
    await queryClient.invalidateQueries({ queryKey: ["buckets"] });
    return bucket;
  };

  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());

  const clearSelection = () => setSelected(new Set<string>());

  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };

  const dropSelected = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

  const refresh = (ids: string[]) => {
    queryClient.invalidateQueries({ queryKey: ["inbox"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    dropSelected(ids);
  };

  const categorize = useMutation(() => ({
    mutationFn: ({ ids, bucketId }: { ids: string[]; bucketId: string }) =>
      categorizeInbox(ids, bucketId),
    onSuccess: (_data, { ids }) => refresh(ids),
  }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const thisYear = new Date().getFullYear();
  let prevDateFormatted: string | null = null;

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
              {(row) => {
                const dateConverted = new Date(row.date);
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
                            <Combobox>
                              <Combobox.Trigger class={styles.rowTrigger}>
                                <Info row={row} />
                                <Amount row={row} />
                              </Combobox.Trigger>
                              <Combobox.Content>
                                <CategoryMenu
                                  buckets={categories()}
                                  onChange={(bucketId) =>
                                    categorize.mutate({
                                      ids: [row.id],
                                      bucketId,
                                    })
                                  }
                                  onCreate={onCreate}
                                  searchPlaceholder="Category"
                                />
                              </Combobox.Content>
                            </Combobox>
                          </div>
                        }
                      >
                        <div
                          class={shell.selectable}
                          onClick={() => toggle(row.id)}
                        >
                          <Checkbox
                            checked={selected().has(row.id)}
                            tabindex={-1}
                            style={{ "pointer-events": "none" }}
                          />
                          <Info row={row} />
                          <Amount row={row} />
                        </div>
                      </Show>
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
