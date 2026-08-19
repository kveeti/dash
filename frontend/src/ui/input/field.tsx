import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { FieldInvalidContext, useFieldInvalid } from "./field-context";
import { hasBackgroundClass, inputGroupClassName } from "./input-styles";

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

export function InputGroup(props: {
  className?: string;
  children: ReactNode;
  /** Override the enclosing field state when group controls validate separately. */
  invalid?: boolean;
}) {
  const fieldInvalid = useFieldInvalid();
  const invalid = props.invalid ?? fieldInvalid;

  return (
    <FieldInvalidContext.Provider value={invalid}>
      <div
        aria-invalid={invalid || undefined}
        className={`${inputGroupClassName} ${hasBackgroundClass(props.className) ? "" : "bg-(--input-bg)/80"} ${props.className ?? ""}`}
      >
        {props.children}
      </div>
    </FieldInvalidContext.Provider>
  );
}
