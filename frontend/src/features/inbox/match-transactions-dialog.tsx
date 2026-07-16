import { Combobox } from "@base-ui/react/combobox";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "wouter";

import {
  useInboxMatchesQuery,
  useMatchInboxMutation,
  type InboxItem,
  type InboxMatch,
} from "../../api/inbox";
import { useI18n } from "../i18n/use-i18n";

import styles from "./match-transactions-dialog.module.css";

export function MatchTransactions() {
  const [params, setParams] = useSearchParams();
  const paramId = params.get("match") ?? "";

  function onClose() {
    const next = new URLSearchParams(params);
    next.delete("match");
    setParams(next, { replace: true });
  }

  return (
    <MatchTransactionsDialog isOpen={!!paramId} onClose={onClose}>
      <MatchTransactionsContent paramId={paramId} onClose={onClose} />
    </MatchTransactionsDialog>
  );
}

function MatchTransactionsContent(props: {
  paramId: string;
  onClose: () => any;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const paramId = useRef(props.paramId);

  const match = useMatchInboxMutation();

  function onMatch(item: InboxMatch) {
    match.mutate({ id: paramId.current, matchId: item.id });
    props.onClose();
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(input), 250);
    return () => window.clearTimeout(timeout);
  }, [input]);

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
        <div className={styles.inputWrap}>
          <Combobox.Input
            className={styles.input}
            placeholder="Search possible matches"
            aria-label="Search possible matches"
          />
          {matches.isFetching && (
            <span className={styles.loading}>loading…</span>
          )}
        </div>

        {matches.isError ? (
          <p className={styles.status}>Couldn’t load matches</p>
        ) : (
          <>
            <Combobox.Empty>
              <p className={styles.empty}>No possible matches found.</p>
            </Combobox.Empty>
            <Combobox.List className={styles.list}>
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
    <Dialog.Root
      open={props.isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.srOnly}>
            Match transactions
          </Dialog.Title>

          {props.children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MatchRow(props: { item: InboxMatch; source: InboxItem | undefined }) {
  const { item, source } = props;
  return (
    <Combobox.Item value={item} className={styles.item}>
      <span className={styles.who}>
        {item.counterparty || item.description || "—"}
      </span>
      <MatchAmount source={source} match={item} />
      <span className={styles.meta}>
        {item.kind === "exchange" ? "Exchange" : "Transfer"} ·{" "}
        <ListDate date={item.date} />
      </span>
      <span className={styles.account}>{item.account}</span>
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
      <span className={styles.amount}>
        {f.amount(Math.abs(source.amount), source.currency)}
      </span>
    );
  }

  const outgoing = source.amount < 0 ? source : match;
  const incoming = source.amount < 0 ? match : source;
  return (
    <span className={styles.amount}>
      {f.amount(outgoing.amount, outgoing.currency)} →{" "}
      {f.amount(incoming.amount, incoming.currency)}
    </span>
  );
}

function Source(props: { row: InboxItem }) {
  const { f } = useI18n();
  const { row } = props;
  return (
    <section className={styles.source}>
      <span className={styles.who}>
        {row.counterparty || row.description || "—"}
      </span>
      <span className={styles.amount}>
        {f.amount(row.amount, row.currency)}
      </span>
      <span className={styles.meta}>
        <ListDate date={row.date} />
      </span>
      <span className={styles.account}>{row.account}</span>
    </section>
  );
}

function ListDate(props: { date: string }) {
  const { f } = useI18n();
  const date = new Date(props.date);
  const isCurrentYear = new Date().getFullYear() === date.getFullYear();
  return <>{isCurrentYear ? f.shortDate(date) : f.longDate(date)}</>;
}
