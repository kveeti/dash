import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, type InputHTMLAttributes, type Ref } from "react";

import { Input } from "./input";
import {
  inputPaddingEndExtraWideClassName,
  inputShellPaddingEndWideClassName,
  popupInputControlClassName,
  popupInputShellClassName,
} from "./input-styles";

type DebouncedSearchInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type"
> & {
  onDebouncedChange: (value: string) => void;
  onClear: () => void;
};

export function DebouncedSearchInput({
  onDebouncedChange,
  onClear,
  className,
  ...props
}: DebouncedSearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notifyChange = useRef(onDebouncedChange);
  notifyChange.current = onDebouncedChange;

  useEffect(() => () => clearTimeout(debounce.current), []);

  return (
    <span className="relative block w-full [&:has(input:placeholder-shown)>button]:invisible [&_input::-webkit-search-cancel-button]:hidden">
      <Input
        {...props}
        ref={ref}
        type="search"
        className={`${inputShellPaddingEndWideClassName} ${className ?? ""}`}
        onChange={(event) => {
          const value = event.currentTarget.value;
          clearTimeout(debounce.current);
          debounce.current = setTimeout(() => notifyChange.current(value), 150);
        }}
      />
      <button
        type="button"
        aria-label="Clear search"
        className="absolute end-1 top-1/2 z-1 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-gray-600 outline-2 outline-transparent outline-offset-[-1px] hover:bg-gray-200 hover:text-gray-900 focus-visible:outline-gray-500"
        onClick={() => {
          if (ref.current) ref.current.value = "";
          clearTimeout(debounce.current);
          onClear();
          ref.current?.focus();
        }}
      >
        <XMarkIcon className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}

type PopupSearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  loading?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function PopupSearchInput({
  loading,
  className,
  ...props
}: PopupSearchInputProps) {
  return (
    <span className={`${popupInputShellClassName} h-9 ${className ?? ""}`}>
      <input
        {...props}
        className={`${popupInputControlClassName} ${loading ? inputPaddingEndExtraWideClassName : ""}`}
      />
      {loading && (
        <span className="pointer-events-none absolute inset-y-0 end-3 z-1 flex items-center text-base text-gray-600">
          loading…
        </span>
      )}
    </span>
  );
}
