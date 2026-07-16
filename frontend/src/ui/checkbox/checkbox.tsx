import type { InputHTMLAttributes } from "react";

import styles from "./checkbox.module.css";

export function Checkbox({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={`${styles.root} ${className ?? ""}`}>
      <input type="checkbox" {...rest} />
      <span className={styles.box} aria-hidden="true" />
    </span>
  );
}
