import { Combobox } from "@base-ui/react/combobox";
import { useRef, useState, type ReactNode } from "react";

import {
  useInboxMatchesQuery,
  useMatchInboxMutation,
  type InboxItem,
  type InboxMatch,
} from "../../api/inbox";
import { createContext } from "../../lib/create-context";
import { setSearchParam, useSearchParam } from "../../lib/search-param";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog/dialog";
import { PopupSearchInput } from "../../ui/input/search-input";
import { useI18n } from "../i18n/use-i18n";
import { useInboxUndo } from "./inbox-undo-context";

const [useContext, context] =
  createContext<ReturnType<typeof useMatchTransactionsValue>>();
export const useMatchTransactions = useContext;

const paramName = "match-to";

function useMatchTransactionsValue() {
  const matchingToId = useSearchParam(paramName);

  return {
    matchingTo: matchingToId,
    openMatchingTo: (matchToId: string) => {
      if (!matchToId) throw new Error("No 'matchToId' provided!");

      setSearchParam(paramName, matchToId);
    },
    close: () => {
      setSearchParam(paramName, undefined);
    },
  };
}

export function MatchTransactions(props: { children: ReactNode }) {
  const contextValue = useMatchTransactionsValue();

  return (
    <context.Provider value={contextValue}>
      {props.children}
      <MatchTransactionsDialog
        isOpen={!!contextValue.matchingTo}
        onClose={contextValue.close}
      >
        <MatchTransactionsContent
          // @ts-expect-error -
          // Dialog won't render children unless isOpen is true.
          // isOpen is only true when there's a matchingTo
          paramId={contextValue.matchingTo}
          onClose={contextValue.close}
        />
      </MatchTransactionsDialog>
    </context.Provider>
  );
}

function MatchTransactionsContent(props: {
  paramId: string;
  onClose: () => any;
}) {
  const [input, setInput] = useState("");
  const search = useDebouncedValue(input, 250);
  const paramId = useRef(props.paramId);

  const match = useMatchInboxMutation();
  const undo = useInboxUndo();

  function onMatch(item: InboxMatch) {
    const rowIds = [paramId.current, item.id];
    void undo.run(rowIds, "Matched transactions", () =>
      match.mutateAsync({ id: paramId.current, matchId: item.id }),
    );
    props.onClose();
  }

  const matches = useInboxMatchesQuery({
    id: paramId.current,
    searchQuery: search,
  });
  const source = matches.data?.source;
  const items = matches.data?.matches ?? [];

  return (
    <div>
      {source && <Source row={source} />}

      <Combobox.Root<InboxMatch>
        filteredItems={items}
        value={null}
        inline
        open={true}
        inputValue={input}
        itemToStringLabel={(item) =>
          item.counterparty || item.description || ""
        }
        onInputValueChange={(nextValue, details) => {
          if (details.reason !== "item-press") setInput(nextValue);
        }}
        onValueChange={(item) => {
          if (item) onMatch(item);
        }}
        // 'always' = "highlight the first item as soon as the list opens".
        // Supported by the underlying AriaCombobox and forwarded untouched,
        // but Combobox's public type narrows the prop to boolean.
        autoHighlight={"always" as unknown as boolean}
      >
        <Combobox.Input
          render={<PopupSearchInput loading={matches.isFetching} />}
          placeholder="Search possible matches"
          aria-label="Search possible matches"
        />

        {matches.isError ? (
          <p className="p-4 text-center text-gray-600">Couldn’t load matches</p>
        ) : (
          <>
            <Combobox.Empty>
              <p className="p-4 text-center text-gray-600">
                No possible matches found.
              </p>
            </Combobox.Empty>
            <Combobox.List className="scroll-py-1 overflow-y-auto overscroll-contain py-1 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(item: InboxMatch) => (
                <MatchRow key={item.id} item={item} source={source} />
              )}
            </Combobox.List>
          </>
        )}
      </Combobox.Root>
    </div>
  );
}

function MatchTransactionsDialog(props: {
  isOpen: boolean;
  onClose: () => any;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onClose();
      }}
    >
      <DialogBackdrop className="bg-black/10" />
      <DialogPopup className="start-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-1rem))] -translate-y-1/2 overflow-hidden text-gray-900">
        <DialogTitle className="absolute m-[-1px] size-px overflow-hidden p-0 [clip-path:inset(50%)] whitespace-nowrap">
          Match transactions
        </DialogTitle>

        {props.children}
      </DialogPopup>
    </Dialog>
  );
}

function MatchRow(props: { item: InboxMatch; source: InboxItem | undefined }) {
  const { item, source } = props;
  const { f } = useI18n();

  return (
    <Combobox.Item
      value={item}
      className="mx-1 grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg px-3 py-2 outline-none select-none data-highlighted:bg-popover-item-selected data-selected:bg-popover-item-selected"
    >
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
        {item.counterparty || item.description || "—"}
      </span>
      <MatchAmount source={source} match={item} />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base text-gray-600">
        {item.kind === "exchange" ? "Exchange" : "Transfer"} ·{" "}
        {f.dateOnly(item.date)}
      </span>
      <span className="text-end whitespace-nowrap text-base text-gray-600">
        {item.account}
      </span>
    </Combobox.Item>
  );
}

function MatchAmount(props: {
  source: InboxItem | undefined;
  match: InboxMatch;
}) {
  const { f } = useI18n();
  const { source, match } = props;
  if (!source) return null;

  if (match.kind !== "exchange") {
    return (
      <span className="text-end whitespace-nowrap tabular-nums text-gray-900">
        {f.amount(Math.abs(source.amount), source.currency)}
      </span>
    );
  }

  const outgoing = source.amount < 0 ? source : match;
  const incoming = source.amount < 0 ? match : source;
  return (
    <span className="text-end whitespace-nowrap tabular-nums text-gray-900">
      {f.amount(outgoing.amount, outgoing.currency)} →{" "}
      {f.amount(incoming.amount, incoming.currency)}
    </span>
  );
}

function Source({ row }: { row: InboxItem }) {
  const { f } = useI18n();
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-popover-border p-3">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
        {row.counterparty || row.description || "—"}
      </span>
      <span className="text-end whitespace-nowrap tabular-nums text-gray-900">
        {f.amount(row.amount, row.currency)}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base text-gray-600">
        {f.dateOnly(row.date)}
      </span>
      <span className="text-end whitespace-nowrap text-base text-gray-600">
        {row.account}
      </span>
    </section>
  );
}
