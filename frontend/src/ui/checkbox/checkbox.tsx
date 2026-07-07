import { type JSX, splitProps } from "solid-js";

import styles from "./checkbox.module.css";

export function Checkbox(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <span class={`${styles.root} ${local.class ?? ""}`}>
      <input type="checkbox" {...rest} />
      <span class={styles.box} aria-hidden="true" />
    </span>
  );
}
