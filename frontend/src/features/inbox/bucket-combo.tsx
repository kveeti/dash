import { Combobox } from "@base-ui/react/combobox";
import {
  useCallback,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { useBucketsQuery } from "../../api/buckets";
import {
  useCategorizeInboxMutation,
  type InboxCategoryTarget,
} from "../../api/inbox";
import { createContext } from "../../lib/create-context";
import { AnimatedHeight } from "../../ui/animated-height/animated-height";
import { useInboxUndo } from "./inbox-undo-context";

import styles from "./bucket-combo.module.css";

const [useBucketCombo, BucketComboContext] =
  createContext<(rowId: string, anchor: HTMLButtonElement) => void>();

const categoryKinds = [
  { kind: "expense", name: "Expense" },
  { kind: "income", name: "Income" },
  { kind: "person", name: "Person" },
] as const;

type BucketComboItem =
  | {
      type: "bucket";
      id: string;
      name: string;
      bucketId: string;
    }
  | {
      type: "create";
      id: string;
      name: string;
      bucketName: string;
      kind: (typeof categoryKinds)[number]["kind"];
    }
  | {
      type: "match";
      id: "match";
      name: string;
    };

type BucketComboGroup = {
  id: string;
  name: string;
  items: BucketComboItem[];
};

type BucketComboSession = {
  rowId: string;
  anchor: {
    contextElement: HTMLButtonElement;
    getBoundingClientRect: () => DOMRect;
  };
};

export function BucketComboRoot(props: {
  children: ReactNode;
  onMatchAction?: (rowId: string) => void;
}) {
  const { contains } = Combobox.useFilter();
  const bucketsQuery = useBucketsQuery();
  const { mutateAsync } = useCategorizeInboxMutation();
  const undo = useInboxUndo();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<BucketComboSession | null>(null);
  const [input, setInput] = useState("");
  const search = input.trim();

  const groups: BucketComboGroup[] = [];
  if (bucketsQuery.data) {
    const buckets = bucketsQuery.data.filter(
      (bucket) =>
        !bucket.hidden &&
        categoryKinds.some(({ kind }) => kind === bucket.kind),
    );
    const matchingBuckets = search
      ? buckets.filter((bucket) => contains(bucket.name, search))
      : buckets;

    if (matchingBuckets.length) {
      groups.push({
        id: "buckets",
        name: "Categorize as…",
        items: matchingBuckets.map((bucket) => ({
          type: "bucket",
          id: bucket.id,
          name: bucket.name,
          bucketId: bucket.id,
        })),
      });
    }

    const exactMatch = buckets.some(
      (bucket) =>
        bucket.name.trim().toLocaleLowerCase() === search.toLocaleLowerCase(),
    );
    if (search && !exactMatch) {
      groups.push({
        id: "create",
        name: "Create…",
        items: categoryKinds.map(({ kind, name }) => ({
          type: "create",
          id: `create:${kind}`,
          name: `${name} "${search}"`,
          bucketName: search,
          kind,
        })),
      });
    }
  }

  if (props.onMatchAction) {
    groups.push({
      id: "actions",
      name: "Actions",
      items: [{ type: "match", id: "match", name: "Match transactions" }],
    });
  }

  const openFor = useCallback((rowId: string, anchor: HTMLButtonElement) => {
    setInput("");
    // Virtual anchor: keeps the last rect when the row unmounts (e.g. after
    // categorizing), so the close animation stays in place instead of
    // snapping to a detached element's (0,0) rect.
    let lastRect = anchor.getBoundingClientRect();
    setSession({
      rowId,
      anchor: {
        contextElement: anchor,
        getBoundingClientRect: () => {
          if (anchor.isConnected) lastRect = anchor.getBoundingClientRect();
          return lastRect;
        },
      },
    });
    setOpen(true);
  }, []);

  function select(item: BucketComboItem) {
    if (!session) return;

    if (item.type === "match") {
      props.onMatchAction?.(session.rowId);
      return;
    }

    const target: InboxCategoryTarget =
      item.type === "bucket"
        ? { type: "bucket", bucketId: item.bucketId }
        : {
            type: "new-bucket",
            kind: item.kind,
            name: item.bucketName,
          };

    void undo.run([session.rowId], "Categorized transaction", () =>
      mutateAsync({ rowIds: [session.rowId], target }),
    );
  }

  function reset() {
    setInput("");
    setSession(null);
  }

  return (
    <BucketComboContext.Provider value={openFor}>
      <Combobox.Root<BucketComboItem>
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
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) reset();
        }}
      >
        {props.children}

        <Combobox.Portal>
          <Combobox.Positioner
            anchor={session?.anchor}
            align="start"
            sideOffset={6}
            className={styles.positioner}
          >
            <Combobox.Popup
              className={styles.popup}
              aria-label="Choose category, person, or action"
              aria-busy={bucketsQuery.isPending || undefined}
            >
              <Combobox.Input
                className={styles.input}
                placeholder="Filter actions..."
                aria-label="Filter categories, people, and actions"
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
                    {(group: BucketComboGroup) => (
                      <Combobox.Group
                        key={group.id}
                        items={group.items}
                        className={styles.group}
                      >
                        <Combobox.GroupLabel className={styles.groupLabel}>
                          {group.name}
                        </Combobox.GroupLabel>
                        <Combobox.Collection>
                          {(item: BucketComboItem) => (
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
    </BucketComboContext.Provider>
  );
}

export function BucketComboTrigger(
  props: { rowId: string } & ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const open = useBucketCombo();
  const { rowId, onClick, type = "button", ...buttonProps } = props;

  return (
    <button
      {...buttonProps}
      type={type}
      aria-haspopup="listbox"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) open(rowId, event.currentTarget);
      }}
    />
  );
}
