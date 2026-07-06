import { type JSX, Show, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";

import styles from "./input.module.css";

interface FieldProps {
  label?: string;
  error?: string;
  class?: string;
  /** Wrapper element; use "div" when the control isn't a native input. */
  as?: "label" | "div";
  children: JSX.Element;
}

export function Field(props: FieldProps) {
  return (
    <Dynamic
      component={props.as ?? "label"}
      class={`${styles.field} ${props.class ?? ""}`}
    >
      <Show when={props.label}>
        <span class={styles.labelRow}>
          <span class={styles.label}>{props.label}</span>
        </span>
      </Show>
      <span class={styles.error}>{props.error}</span>
      {props.children}
    </Dynamic>
  );
}

export function InputGroup(props: { class?: string; children: JSX.Element }) {
  return (
    <div class={`${styles.group} ${props.class ?? ""}`}>{props.children}</div>
  );
}

interface Props extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input(props: Props) {
  const [local, rest] = splitProps(props, ["label", "error", "class"]);
  return (
    <Field label={local.label} error={local.error} class={local.class}>
      <input
        {...rest}
        class={`${styles.control} ${local.error ? styles.invalid : ""}`}
      />
    </Field>
  );
}
