import { useRef, type KeyboardEvent } from "react";

import type {
  TagActionItem,
  TransactionActionGroup,
  TransactionActionItem,
} from "./transaction-action-types";

export function useTagOptionKeyboard(props: {
  groups: TransactionActionGroup[];
  onToggleTag: (item: TagActionItem) => void;
}) {
  const highlightedId = useRef<string | null>(null);
  const armed = useRef(false);

  function reset() {
    highlightedId.current = null;
    armed.current = false;
  }

  function onItemHighlighted(
    item: TransactionActionItem | undefined,
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

    const items = props.groups.flatMap((group) => group.items);
    let highlighted = items.find((item) => item.id === highlightedId.current);
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
      highlighted = index >= 0 ? items[index] : undefined;
    }
    if (highlighted?.type !== "tag") return;

    event.preventDefault();
    if (!event.repeat) props.onToggleTag(highlighted);
  }

  return { reset, onItemHighlighted, onInputKeyDown };
}
