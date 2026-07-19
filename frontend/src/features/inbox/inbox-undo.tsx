import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, type ReactNode } from "react";

import {
  inboxKeys,
  restoreInboxRows,
  type InboxCacheSnapshot,
} from "../../api/inbox";
import { restoreQueries, snapshotQueries } from "../../api/query-snapshot";
import { tagKeys, transactionKeys } from "../../api/transactions";
import type { UseSelectionReturn } from "../../lib/list-shell/selection";
import { UndoProvider } from "../../lib/undo/undo";
import { useUndo } from "../../lib/undo/undo-context";
import { InboxUndoContext } from "./inbox-undo-context";

interface SelectionSnapshot {
  selectMode: boolean;
  selected: string[];
}

interface InboxUndoInput {
  rowIds: string[];
  cache: InboxCacheSnapshot;
  selection: SelectionSnapshot;
  categorizationPromise: Promise<unknown>;
}

export function InboxUndoProvider(props: {
  selection: UseSelectionReturn;
  children: ReactNode;
}) {
  return (
    <UndoProvider>
      <InboxUndoActions selection={props.selection}>
        {props.children}
      </InboxUndoActions>
    </UndoProvider>
  );
}

function InboxUndoActions(props: {
  selection: UseSelectionReturn;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const selectionRef = useRef(props.selection);
  selectionRef.current = props.selection;
  const { remember } = useUndo();
  const { mutate: undo } = useMutation({
    mutationFn: async (input: InboxUndoInput) => {
      try {
        await input.categorizationPromise;
      } catch {
        return;
      }
      await restoreInboxRows(input.rowIds);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.all });
      const rollback = {
        cache: snapshotQueries(queryClient, input.cache),
        selection: snapshotSelection(selectionRef.current),
      };
      restoreQueries(queryClient, input.cache);
      selectionRef.current.restoreSelection(
        input.selection.selectMode,
        input.selection.selected,
      );
      return rollback;
    },
    onError: (_error, _input, rollback) => {
      if (!rollback) return;
      restoreQueries(queryClient, rollback.cache);
      selectionRef.current.restoreSelection(
        rollback.selection.selectMode,
        rollback.selection.selected,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });

  const run = useCallback(
    function run<T>(
      rowIds: string[],
      label: string,
      operation: () => Promise<T>,
    ) {
      const input: InboxUndoInput = {
        rowIds,
        cache: queryClient.getQueriesData({ queryKey: inboxKeys.all }),
        selection: snapshotSelection(selectionRef.current),
        categorizationPromise: operation(),
      };
      const forget = remember({
        label,
        confirmation: () =>
          selectionConfirmation(selectionRef.current, input.selection),
        undo: () => undo(input),
      });
      input.categorizationPromise.catch(() => {
        forget();
        if (input.selection.selectMode)
          selectionRef.current.restoreSelection(true, input.selection.selected);
      });
      return input.categorizationPromise as Promise<T>;
    },
    [queryClient, remember, undo],
  );

  return (
    <InboxUndoContext.Provider value={{ run }}>
      {props.children}
    </InboxUndoContext.Provider>
  );
}

function snapshotSelection(selection: UseSelectionReturn): SelectionSnapshot {
  return {
    selectMode: selection.selectMode,
    selected: [...selection.selected],
  };
}

function selectionConfirmation(
  current: UseSelectionReturn,
  saved: SelectionSnapshot,
) {
  if (
    current.selected.size === 0 ||
    (current.selectMode === saved.selectMode &&
      sameSelection(current.selected, saved.selected))
  )
    return null;

  const count = current.selected.size;
  return {
    title: "Replace current selection?",
    description: saved.selectMode
      ? `Undoing will replace the ${count} currently selected row${count === 1 ? "" : "s"} with your previous selection.`
      : `Undoing will clear the ${count} currently selected row${count === 1 ? "" : "s"}.`,
  };
}

function sameSelection(current: Set<string>, saved: string[]) {
  return current.size === saved.length && saved.every((id) => current.has(id));
}
