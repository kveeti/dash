import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";

import { Button } from "../../ui/button/button";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { DebouncedSearchInput } from "../../ui/input/search-input";

export function Filterbar(props: {
  selectLabel: string;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  search?: string;
  onSearch: (value: string | undefined) => void;
  end?: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-(--nav-height) z-2 border-t border-gray-200 bg-canvas/80 backdrop-blur-md sm:sticky sm:top-[var(--nav-height)] sm:flex sm:items-center sm:border-0">
      <div className="mx-auto flex h-(--filterbar-height) w-full max-w-(--page-width) items-center gap-2 px-3 sm:p-2 sm:px-6">
        <div className="flex flex-none items-center">
          <Checkbox
            aria-label={props.selectLabel}
            checked={props.selectMode}
            onCheckedChange={props.onSelectMode}
          />
          <AnimatePresence initial={false}>
            {props.selectMode && (
              <SelectAllButton
                allVisibleSelected={props.allVisibleSelected}
                onClick={props.onToggleAll}
              />
            )}
          </AnimatePresence>
        </div>
        <div className="min-w-0 flex-1">
          <DebouncedSearchInput
            placeholder="Search..."
            defaultValue={props.search}
            onDebouncedChange={(value) => props.onSearch(value || undefined)}
            onClear={() => props.onSearch(undefined)}
          />
        </div>
        {props.end}
      </div>
    </div>
  );
}

function SelectAllButton(props: {
  allVisibleSelected: boolean;
  onClick: () => void;
}) {
  const isPresent = useIsPresent();
  const label = props.allVisibleSelected ? "Deselect all" : "Select all";

  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.25, 0.8, 0.25, 1] as const };

  return (
    <motion.div
      className="flex-none overflow-hidden"
      initial={{ width: 0 }}
      animate={{ width: "auto" }}
      exit={{ width: 0 }}
      layout="size"
      transition={{ ...transition, layout: transition }}
      inert={!isPresent}
    >
      <div className="pl-2">
        <Button
          type="button"
          variant="ghost"
          className="relative px-2"
          aria-label={label}
          onClick={props.onClick}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={label}
              className="block"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </motion.div>
  );
}
