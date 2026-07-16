import { useRef, useState } from "react";

export function useSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const anchor = useRef<string | null>(null);
  const rangeBase = useRef<Set<string> | null>(null);

  const clearSelection = () => {
    anchor.current = null;
    rangeBase.current = null;
    setSelected(new Set<string>());
  };

  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };

  const select = (ids: string[]) => {
    anchor.current = null;
    rangeBase.current = null;
    setSelected((prev) => new Set([...prev, ...ids]));
  };

  const toggle = (id: string) => {
    anchor.current = id;
    rangeBase.current = null;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectThrough = (id: string, orderedIds: string[]) => {
    const anchorId = anchor.current;
    const from = anchorId ? orderedIds.indexOf(anchorId) : -1;
    const to = orderedIds.indexOf(id);
    if (!anchorId || from === -1 || to === -1) {
      toggle(id);
      return;
    }
    if (!rangeBase.current) {
      rangeBase.current = new Set(selected);
      rangeBase.current.delete(anchorId);
    }
    const range = orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1);
    setSelected(new Set([...rangeBase.current, ...range]));
  };

  const drop = (ids: string[]) => {
    anchor.current = null;
    rangeBase.current = null;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  return {
    selectMode,
    setSelectMode,
    selected,
    toggle,
    select,
    selectThrough,
    clearSelection,
    exitSelect,
    drop,
  };
}

export type UseSelectionReturn = ReturnType<typeof useSelection>;
