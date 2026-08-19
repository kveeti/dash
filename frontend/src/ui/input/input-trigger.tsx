import type { ButtonHTMLAttributes, Ref } from "react";

import { useFieldInvalid } from "./field-context";
import { inputTriggerClassName, invalidInputClassName } from "./input-styles";

type InputTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function InputTrigger({
  invalid: invalidProp,
  className,
  ...props
}: InputTriggerProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = invalidProp ?? fieldInvalid;

  return (
    <button
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputTriggerClassName} ${invalid ? invalidInputClassName : ""} ${className ?? ""}`}
    />
  );
}
