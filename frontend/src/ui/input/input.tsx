import type { InputHTMLAttributes, ReactNode } from "react";

import styles from "./input.module.css";

interface FieldProps {
  label?: string;
  error?: string;
  className?: string;
  /** Wrapper element; use "div" when the control isn't a native input. */
  as?: "label" | "div";
  children: ReactNode;
}

export function Field({ as: As = "label", ...props }: FieldProps) {
  return (
    <As className={`${styles.field} ${props.className ?? ""}`}>
      {props.label && (
        <span className={styles.labelRow}>
          <span className={styles.label}>{props.label}</span>
        </span>
      )}
      <span className={styles.error}>{props.error}</span>
      {props.children}
    </As>
  );
}

export function InputGroup(props: { className?: string; children: ReactNode }) {
  return (
    <div className={`${styles.group} ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...rest }: Props) {
  return (
    <Field label={label} error={error} className={className}>
      <input
        {...rest}
        className={`${styles.control} ${error ? styles.invalid : ""}`}
      />
    </Field>
  );
}
