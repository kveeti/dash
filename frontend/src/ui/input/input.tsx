import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { useFieldInvalid } from "./field-context";
import {
  hasBackgroundClass,
  inputControlClassName,
  inputGroupInputClassName,
  inputPaddingEndWideClassName,
  inputPaddingStartWideClassName,
  inputShellClassName,
} from "./input-styles";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  ref?: Ref<HTMLInputElement>;
} & (
    | {
        grouped: true;
        iconLeft?: never;
        iconRight?: never;
      }
    | {
        grouped?: false;
        iconLeft?: ReactNode;
        iconRight?: ReactNode;
      }
  );

export function Input({
  error,
  grouped,
  iconLeft,
  iconRight,
  className,
  ...rest
}: InputProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;

  if (grouped) {
    return (
      <span
        data-invalid={invalid || undefined}
        className={`${inputShellClassName} ${inputGroupInputClassName} ${className ?? ""}`}
      >
        <input
          {...rest}
          aria-invalid={invalid || undefined}
          className={inputControlClassName}
        />
      </span>
    );
  }

  return (
    <span
      data-invalid={invalid || undefined}
      className={`${inputShellClassName} ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      {iconLeft && (
        <span
          className="pointer-events-none absolute inset-y-0 start-3 z-1 flex items-center text-gray-600 [&>svg]:size-4"
          aria-hidden="true"
        >
          {iconLeft}
        </span>
      )}
      <input
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${inputControlClassName} ${iconLeft ? inputPaddingStartWideClassName : ""} ${iconRight ? inputPaddingEndWideClassName : ""}`}
      />
      {iconRight && (
        <span
          className="pointer-events-none absolute inset-y-0 end-3 z-1 flex items-center text-gray-600 [&>svg]:size-4"
          aria-hidden="true"
        >
          {iconRight}
        </span>
      )}
    </span>
  );
}
