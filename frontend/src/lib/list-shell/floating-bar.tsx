import type { ReactNode } from "react";

import { Button } from "../../ui/button/button";

import styles from "./list-shell.module.css";

export function SelectionCountButton(props: {
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={props.onClick}
      variant="ghost"
      style={{ padding: "0.5rem" }}
    >
      <svg
        className={styles.close}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <span className={styles.count}>{props.count} selected</span>
    </Button>
  );
}

export function CloseButton(props: { onClick: () => void }) {
  return (
    <Button
      onClick={props.onClick}
      variant="ghost"
      style={{ inlineSize: "2.25rem", padding: "0.5rem" }}
    >
      <svg
        className={styles.close}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </Button>
  );
}

export function FloatingBarWrap(props: { show: boolean; children: ReactNode }) {
  return (
    <div
      className={styles.floatingbarPos}
      data-show={props.show}
      inert={!props.show}
    >
      <div className={styles.floatingbar}>{props.children}</div>
    </div>
  );
}
