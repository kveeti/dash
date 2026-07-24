import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "../../ui/button/button";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Input } from "../../ui/input/input";

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
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchInput = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => () => clearTimeout(debounce.current), []);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.25, 0.8, 0.25, 1] as const };

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
                transition={transition}
              />
            )}
          </AnimatePresence>
        </div>
        <div className="relative min-w-0 flex-1 [&:has(input:placeholder-shown)>button]:invisible [&_input]:pe-9 [&_input::-webkit-search-cancel-button]:hidden">
          <Input
            ref={searchInput}
            type="search"
            placeholder="Search..."
            defaultValue={props.search}
            onChange={(e) => {
              const value = e.currentTarget.value || undefined;
              clearTimeout(debounce.current);
              debounce.current = setTimeout(() => props.onSearch(value), 150);
            }}
          />
          <button
            type="button"
            aria-label="Clear search"
            className="absolute end-1 top-1/2 z-1 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-gray-600 outline-[1.5px] outline-transparent outline-offset-[-1px] hover:bg-gray-200 hover:text-gray-900 focus-visible:outline-gray-500"
            onClick={() => {
              clearTimeout(debounce.current);
              if (searchInput.current) searchInput.current.value = "";
              props.onSearch(undefined);
              searchInput.current?.focus();
            }}
          >
            <XMarkIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        {props.end}
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
      className="flex-none overflow-hidden"
      initial={{ width: 0 }}
      animate={{ width: "auto" }}
      exit={{ width: 0 }}
      layout="size"
      transition={{ ...props.transition, layout: props.transition }}
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
