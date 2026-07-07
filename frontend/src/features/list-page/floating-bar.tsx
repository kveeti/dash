import { type Bucket } from "../../api/buckets";
import { Button } from "../../ui/button/button";
import { BucketCombobox } from "../transactions/bucket-combobox";

import styles from "./list-page.module.css";

export function FloatingBar(props: {
  count: number;
  categories: Bucket[];
  onClear: () => void;
  onExit: () => void;
  onCategorize: (bucketId: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
}) {
  return (
    <div class={styles.floatingbarPos}>
      <div class={styles.floatingbar}>
        <Button
          onClick={props.onClear}
          variant="ghost"
          style={{ padding: "0.5rem" }}
        >
          <svg
            class={styles.close}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
          <span class={styles.count}>{props.count} selected</span>
        </Button>

        <BucketCombobox
          class={styles.barPicker}
          label=""
          buckets={props.categories}
          value={null}
          onChange={props.onCategorize}
          onCreate={props.onCreate}
          placeholder="Categorize…"
          searchPlaceholder="Category"
        />

        <Button
          onClick={props.onExit}
          variant="outline"
          style={{ "inline-size": "2.25rem", padding: "0.5rem" }}
        >
          <svg
            class={styles.close}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
              clip-rule="evenodd"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}
