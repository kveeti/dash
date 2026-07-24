import { useRef, type KeyboardEvent } from "react";

export function useComboboxOptionKeyboard<Item extends { id: string }>(props: {
  items: Item[];
  onSpace: (item: Item) => void;
  canSelectWithSpace?: (item: Item) => boolean;
}) {
  const highlightedId = useRef<string | null>(null);
  const armed = useRef(false);

  function reset() {
    highlightedId.current = null;
    armed.current = false;
  }

  function onItemHighlighted(
    item: Item | undefined,
    details: { reason: string },
  ) {
    highlightedId.current = item?.id ?? null;
    if (details.reason === "pointer") armed.current = false;
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      armed.current = true;
      return;
    }
    if (event.key !== " " || !armed.current) return;

    let highlighted = props.items.find(
      (item) => item.id === highlightedId.current,
    );
    if (!highlighted) {
      const activeId = event.currentTarget.getAttribute(
        "aria-activedescendant",
      );
      const activeOption = activeId ? document.getElementById(activeId) : null;
      const listbox = activeOption?.closest('[role="listbox"]');
      const options = listbox
        ? [...listbox.querySelectorAll('[role="option"]')]
        : [];
      const index = activeOption ? options.indexOf(activeOption) : -1;
      highlighted = index >= 0 ? props.items[index] : undefined;
    }
    if (!highlighted || props.canSelectWithSpace?.(highlighted) === false)
      return;

    event.preventDefault();
    if (!event.repeat) props.onSpace(highlighted);
  }

  return { reset, onItemHighlighted, onInputKeyDown };
}
