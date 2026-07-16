import type { ButtonHTMLAttributes } from "react";

import styles from "./button.module.css";

type Variant = "primary" | "outline" | "ghost" | "destructive";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`${styles.button} ${styles[variant]} ${className ?? ""}`}
    />
  );
}
