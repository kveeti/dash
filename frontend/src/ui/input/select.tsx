import { ChevronDownIcon } from "@heroicons/react/24/outline";
import type { SelectHTMLAttributes } from "react";

import { useFieldInvalid } from "./field-context";
import {
  hasBackgroundClass,
  inputControlClassName,
  inputGroupSelectClassName,
  inputPaddingEndWideClassName,
  inputShellClassName,
} from "./input-styles";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  grouped?: boolean;
}

export function Select({
  error,
  grouped,
  className,
  children,
  ...rest
}: SelectProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;

  if (grouped) {
    return (
      <span
        data-invalid={invalid || undefined}
        className={`${inputShellClassName} ${inputGroupSelectClassName} ${className ?? ""}`}
      >
        <select
          {...rest}
          aria-invalid={invalid || undefined}
          className={`${inputControlClassName} ${inputPaddingEndWideClassName} cursor-pointer appearance-none`}
        >
          {children}
        </select>
        <ChevronDownIcon
          className="pointer-events-none absolute end-[.7rem] top-1/2 z-1 size-4 -translate-y-1/2 text-gray-700"
          aria-hidden="true"
        />
      </span>
    );
  }

  return (
    <span
      data-invalid={invalid || undefined}
      className={`${inputShellClassName} ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${inputControlClassName} ${inputPaddingEndWideClassName} cursor-pointer appearance-none`}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute end-[.7rem] top-1/2 z-1 size-4 -translate-y-1/2 text-gray-700"
        aria-hidden="true"
      />
    </span>
  );
}
