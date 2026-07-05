import { type JSX, Show, splitProps } from "solid-js";

import styles from "./input.module.css";

interface FieldProps {
  label: string;
  error?: string;
  class?: string;
  children: JSX.Element;
}

export function Field(props: FieldProps) {
  return (
    <label class={`${styles.field} ${props.class ?? ""}`}>
      <span class={styles.labelRow}>
        <span class={styles.label}>{props.label}</span>
        <Show when={props.error}>
          <span class={styles.error}>{props.error}</span>
        </Show>
      </span>
      {props.children}
    </label>
  );
}

export function InputGroup(props: { class?: string; children: JSX.Element }) {
  return (
    <div class={`${styles.group} ${props.class ?? ""}`}>{props.children}</div>
  );
}

interface Props extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input(props: Props) {
  const [local, rest] = splitProps(props, ["label", "error", "class"]);
  return (
    <Field label={local.label} error={local.error} class={local.class}>
      <input
        {...rest}
        class={`${styles.control} ${local.error ? styles.controlError : ""}`}
      />
    </Field>
  );
}
