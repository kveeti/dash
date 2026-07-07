import { onCleanup } from "solid-js";

import { Checkbox } from "../../ui/checkbox/checkbox";

import inputStyles from "../../ui/input/input.module.css";
import styles from "./list-page.module.css";

export function Filterbar(props: {
  selectLabel: string;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  search: string;
  onSearch: (value: string | undefined) => void;
}) {
  let debounce: ReturnType<typeof setTimeout>;
  onCleanup(() => clearTimeout(debounce));

  return (
    <div class={styles.filterbarPos}>
      <div class={styles.filterbar}>
        <Checkbox
          aria-label={props.selectLabel}
          checked={props.selectMode}
          onChange={(e) => props.onSelectMode(e.currentTarget.checked)}
        />
        <input
          class={inputStyles.control}
          type="search"
          placeholder="Search..."
          value={props.search}
          onInput={(e) => {
            const value = e.currentTarget.value || undefined;
            clearTimeout(debounce);
            debounce = setTimeout(() => props.onSearch(value), 150);
          }}
        />
      </div>
    </div>
  );
}
