import type { ReactNode } from "react";

import { useInboxItemQuery, useSplitInboxMutation } from "../../api/inbox";
import { setSearchParam, useSearchParam } from "../../lib/search-param";
import {
  SplitTransactionDialog,
  type SplitAllocation,
} from "../transactions/split-transaction-dialog";
import { useInboxUndo } from "./inbox-undo-context";
import { SplitInboxContext } from "./split-inbox-context";

const paramName = "split-inbox";

export function SplitInboxTransactions(props: { children: ReactNode }) {
  const rowId = useSearchParam(paramName);
  const value = {
    open: (id: string) => setSearchParam(paramName, id),
    close: () => setSearchParam(paramName, undefined),
  };

  return (
    <SplitInboxContext.Provider value={value}>
      {props.children}
      {rowId && <SplitInboxDialog rowId={rowId} onClose={value.close} />}
    </SplitInboxContext.Provider>
  );
}

function SplitInboxDialog(props: { rowId: string; onClose: () => void }) {
  const row = useInboxItemQuery(props.rowId);
  const split = useSplitInboxMutation();
  const undo = useInboxUndo();

  if (!row.data) return null;
  const allocations: SplitAllocation[] = [
    { bucketId: "", amount: 0 },
    { bucketId: "", amount: 0 },
  ];

  return (
    <SplitTransactionDialog
      open
      source={{
        counterparty: row.data.counterparty,
        description: row.data.description,
        amount: row.data.amount,
        currency: row.data.currency,
        date: row.data.date,
        account: row.data.account,
      }}
      allocations={allocations}
      minimumAllocations={2}
      error={row.error?.message ?? split.error?.message}
      onClose={props.onClose}
      onSubmit={(postings) => {
        if (split.isPending) return;
        void (async () => {
          try {
            await undo.run([row.data.id], "Split transaction", () =>
              split.mutateAsync({ rowId: row.data.id, postings }),
            );
            props.onClose();
          } catch {
            // The dialog keeps the input and shows the mutation error.
          }
        })();
      }}
    />
  );
}
