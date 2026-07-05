import { type JSX, splitProps } from "solid-js";

import styles from "./button.module.css";

type Variant = "primary" | "outline" | "ghost" | "destructive";

interface Props extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button(props: Props) {
  const [local, rest] = splitProps(props, ["class", "variant", "children"]);
  return (
    <button
      {...rest}
      class={`${styles.button} ${styles[local.variant ?? "primary"]} ${local.class ?? ""}`}
    >
      {local.children}
    </button>
  );
}
