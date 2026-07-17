import { forwardRef, type ButtonHTMLAttributes } from "react";

import styles from "./button.module.css";

export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", className, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      className={`${styles.button} ${styles[variant]} ${className ?? ""}`}
    />
  );
});
