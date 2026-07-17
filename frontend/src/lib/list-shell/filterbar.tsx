import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
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
  const reduceMotion = useReducedMotion();
  useEffect(() => () => clearTimeout(debounce.current), []);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.25, 0.8, 0.25, 1] as const };

  return (
    <div className={styles.filterbarPos}>
      <div className={styles.filterbar}>
        <div className={styles.selectControls}>
          <Checkbox
            aria-label={props.selectLabel}
            checked={props.selectMode}
            onChange={(e) => props.onSelectMode(e.currentTarget.checked)}
          />
          <AnimatePresence initial={false}>
            {props.selectMode && (
              <SelectAllButton
                allVisibleSelected={props.allVisibleSelected}
                onClick={props.onToggleAll}
                transition={transition}
              />
            )}
          </AnimatePresence>
        </div>
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

function SelectAllButton(props: {
  allVisibleSelected: boolean;
  onClick: () => void;
  transition: {
    duration: number;
    ease?: readonly [number, number, number, number];
  };
}) {
  const isPresent = useIsPresent();
  const label = props.allVisibleSelected ? "Deselect all" : "Select all";

  return (
    <motion.div
      className={styles.selectAllSlot}
      initial={{ width: 0 }}
      animate={{ width: "auto" }}
      exit={{ width: 0 }}
      layout="size"
      transition={{ ...props.transition, layout: props.transition }}
      inert={!isPresent}
    >
      <div className={styles.selectAllInner}>
        <Button
          type="button"
          variant="ghost"
          className={styles.selectAllButton}
          aria-label={label}
          onClick={props.onClick}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={label}
              className={styles.selectAllLabel}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={props.transition}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </motion.div>
  );
}
