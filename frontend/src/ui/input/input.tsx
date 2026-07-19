import {
  ChevronDownIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

import { FieldInvalidContext, useFieldInvalid } from "./field-context";
import {
  fileInputClassName,
  inputControlClassName,
  inputGroupClassName,
  invalidInputClassName,
  invalidInputGroupClassName,
} from "./input-styles";

interface FieldProps {
  label?: string;
  error?: string;
  className?: string;
  /** Wrapper element; use "div" when the control isn't a native input. */
  as?: "label" | "div";
  children: ReactNode;
}

export function Field({ as: As = "label", ...props }: FieldProps) {
  const invalid = Boolean(props.error);

  return (
    <FieldInvalidContext.Provider value={invalid}>
      <As
        className={`flex flex-col gap-1 min-[30rem]:col-span-full min-[30rem]:grid min-[30rem]:grid-cols-subgrid min-[30rem]:items-center min-[30rem]:gap-x-8 min-[30rem]:[&>:last-child]:col-start-2 min-[30rem]:[&>:last-child]:row-start-2 ${props.className ?? ""}`}
      >
        {props.label && (
          <span className="flex items-baseline justify-between gap-2 min-[30rem]:col-start-1 min-[30rem]:row-start-2 min-[30rem]:justify-start">
            <span className="text-sm text-gray-700 min-[30rem]:text-right">
              {props.label}
            </span>
          </span>
        )}
        {props.error && (
          <span className="flex min-h-[1lh] items-center gap-1 text-xs text-(--input-invalid-text) min-[30rem]:col-start-2 min-[30rem]:row-start-1">
            <ExclamationCircleIcon
              className="size-[1.25em] shrink-0"
              aria-hidden="true"
            />
            {props.error}
          </span>
        )}
        {props.children}
      </As>
    </FieldInvalidContext.Provider>
  );
}

function hasBackgroundClass(className?: string) {
  return className?.split(/\s+/).some((name) => name.startsWith("bg-"));
}

export function InputGroup(props: {
  className?: string;
  children: ReactNode;
  /** Override the enclosing field state when group controls validate separately. */
  invalid?: boolean;
}) {
  const fieldInvalid = useFieldInvalid();
  const invalid = props.invalid ?? fieldInvalid;

  return (
    <div
      aria-invalid={invalid || undefined}
      className={`${inputGroupClassName} ${hasBackgroundClass(props.className) ? "" : "bg-(--input-bg)/80"} ${invalid ? invalidInputGroupClassName : ""} ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  grouped?: boolean;
}

// TODO: Make custom. On IOS "Choose File" would require half a pixel more
// height to be vertically centered. Going custom is more sane
export function FileInput({
  className,
  ...props
}: Omit<Props, "type" | "grouped">) {
  return (
    <Input
      {...props}
      type="file"
      className={`${fileInputClassName} ${className ?? ""}`}
    />
  );
}

export function Input({ error, grouped, className, ...rest }: Props) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;

  if (grouped) {
    return (
      <input
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${invalid ? invalidInputClassName : ""} ${className ?? ""}`}
      />
    );
  }

  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${inputControlClassName} ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${invalid ? invalidInputClassName : ""} ${className ?? ""}`}
    />
  );
}

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
      <>
        <select
          {...rest}
          aria-invalid={invalid || undefined}
          className={`${invalid ? invalidInputClassName : ""} ${className ?? ""}`}
        >
          {children}
        </select>
        <ChevronDownIcon
          className="pointer-events-none absolute end-[.7rem] top-1/2 !size-4 -translate-y-1/2 !p-0 text-gray-700"
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <span
      className={`relative block h-9 w-full overflow-hidden rounded-xl ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${inputControlClassName} h-full cursor-pointer appearance-none pr-9 ${invalid ? invalidInputClassName : ""}`}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute end-[.7rem] top-1/2 size-4 -translate-y-1/2 text-gray-700"
        aria-hidden="true"
      />
    </span>
  );
}
