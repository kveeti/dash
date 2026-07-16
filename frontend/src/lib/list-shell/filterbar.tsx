import { useEffect, useRef } from "react";

import { Button } from "../../ui/button/button";
import { Checkbox } from "../../ui/checkbox/checkbox";

import inputStyles from "../../ui/input/input.module.css";
import styles from "./list-shell.module.css";

export function Filterbar(props: {
  selectLabel: string;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  search?: string;
  onSearch: (value: string | undefined) => void;
  tag?: string;
  onClearTag?: () => void;
}) {
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);

  return (
    <div className={styles.filterbarPos}>
      <div className={styles.filterbar}>
        <Checkbox
          aria-label={props.selectLabel}
          checked={props.selectMode}
          onChange={(e) => props.onSelectMode(e.currentTarget.checked)}
        />
        {props.selectMode && (
          <Button
            type="button"
            variant="ghost"
            style={{ padding: "0.5rem" }}
            onClick={props.onToggleAll}
          >
            {props.allVisibleSelected ? "Deselect all" : "Select all"}
          </Button>
        )}
        {props.tag && (
          <button
            className={styles.activeFilter}
            onClick={() => props.onClearTag?.()}
          >
            #{props.tag} ×
          </button>
        )}
        <input
          className={inputStyles.control}
          type="search"
          placeholder="Search..."
          defaultValue={props.search}
          onChange={(e) => {
            const value = e.currentTarget.value || undefined;
            clearTimeout(debounce.current);
            debounce.current = setTimeout(() => props.onSearch(value), 150);
          }}
        />
      </div>
    </div>
  );
}
