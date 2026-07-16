import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";

import {
  useBucketsQuery,
  useCreateBucketMutation,
  type Bucket,
  type BucketKind,
} from "../../api/buckets";
import { AnimatedHeight } from "../../ui/animated-height/animated-height";

import styles from "./bucket-picker.module.css";

const kindLabels: Record<BucketKind, string> = {
  asset: "Asset",
  liability: "Liability",
  expense: "Expense",
  income: "Income",
  person: "Person",
  clearing: "Clearing",
};

type PickerItem =
  | { type: "bucket"; id: string; name: string; bucket: Bucket }
  | {
      type: "create";
      id: string;
      name: string;
      bucketName: string;
      kind: BucketKind;
    };

type PickerGroup = { id: string; name: string; items: PickerItem[] };

export function BucketPicker(props: {
  kinds: BucketKind[];
  createKinds?: BucketKind[];
  value?: Bucket | null;
  onPick: (bucket: Bucket) => void;
  placeholder?: string;
}) {
  const { contains } = Combobox.useFilter();
  const bucketsQuery = useBucketsQuery();
  const createBucket = useCreateBucketMutation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const search = input.trim();

  const groups: PickerGroup[] = [];
  if (bucketsQuery.data) {
    const buckets = bucketsQuery.data.filter(
      (bucket) => !bucket.hidden && props.kinds.includes(bucket.kind),
    );
    const matching = search
      ? buckets.filter((bucket) => contains(bucket.name, search))
      : buckets;

    if (matching.length) {
      groups.push({
        id: "buckets",
        name: "Choose…",
        items: matching.map((bucket) => ({
          type: "bucket",
          id: bucket.id,
          name: bucket.name,
          bucket,
        })),
      });
    }

    const createKinds = props.createKinds ?? [];
    const exactMatch = buckets.some(
      (bucket) =>
        bucket.name.trim().toLocaleLowerCase() === search.toLocaleLowerCase(),
    );
    if (search && !exactMatch && createKinds.length) {
      groups.push({
        id: "create",
        name: "Create…",
        items: createKinds.map((kind) => ({
          type: "create",
          id: `create:${kind}`,
          name: `${kindLabels[kind]} "${search}"`,
          bucketName: search,
          kind,
        })),
      });
    }
  }

  async function select(item: PickerItem) {
    if (item.type === "bucket") {
      props.onPick(item.bucket);
      return;
    }
    const bucket = await createBucket.mutateAsync({
      kind: item.kind,
      name: item.bucketName,
    });
    props.onPick(bucket);
  }

  return (
    <Combobox.Root<PickerItem>
      items={groups}
      value={null}
      open={open}
      inputValue={input}
      filter={null}
      autoHighlight
      itemToStringLabel={(item) => item.name}
      onInputValueChange={(nextValue, details) => {
        if (details.reason !== "item-press") setInput(nextValue);
      }}
      onValueChange={(item) => {
        if (item) select(item);
      }}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setInput("");
      }}
    >
      <Combobox.Trigger className={styles.trigger}>
        <span className={props.value ? styles.value : styles.placeholder}>
          {props.value ? props.value.name : (props.placeholder ?? "Select…")}
        </span>
        <Combobox.Icon className={styles.icon}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={6}
          className={styles.positioner}
        >
          <Combobox.Popup
            className={styles.popup}
            aria-busy={bucketsQuery.isPending || undefined}
          >
            <Combobox.Input
              className={styles.input}
              placeholder={props.placeholder ?? "Search…"}
              aria-label="Filter buckets"
            />

            <AnimatedHeight>
              <div className={styles.scroller}>
                <Combobox.Status>
                  {bucketsQuery.isPending ? (
                    <div className={styles.status}>Loading…</div>
                  ) : bucketsQuery.isError ? (
                    <div className={styles.status}>Error loading buckets</div>
                  ) : null}
                </Combobox.Status>

                <Combobox.Empty>
                  {!bucketsQuery.isPending && !bucketsQuery.isError ? (
                    <div className={styles.empty}>No matches</div>
                  ) : null}
                </Combobox.Empty>

                <Combobox.List className={styles.list}>
                  {(group: PickerGroup) => (
                    <Combobox.Group
                      key={group.id}
                      items={group.items}
                      className={styles.group}
                    >
                      <Combobox.GroupLabel className={styles.groupLabel}>
                        {group.name}
                      </Combobox.GroupLabel>
                      <Combobox.Collection>
                        {(item: PickerItem) => (
                          <Combobox.Item
                            key={item.id}
                            value={item}
                            className={styles.item}
                          >
                            <span>{item.name}</span>
                          </Combobox.Item>
                        )}
                      </Combobox.Collection>
                    </Combobox.Group>
                  )}
                </Combobox.List>
              </div>
            </AnimatedHeight>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
