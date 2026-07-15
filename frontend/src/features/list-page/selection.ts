import { createSignal } from "solid-js";

export function createSelection() {
  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());

  const clearSelection = () => setSelected(new Set<string>());

  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const drop = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

  return {
    selectMode,
    setSelectMode,
    selected,
    toggle,
    clearSelection,
    exitSelect,
    drop,
  };
}
