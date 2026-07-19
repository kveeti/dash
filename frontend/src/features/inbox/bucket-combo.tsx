import { Combobox } from "@base-ui/react/combobox";
import {
  useCallback,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { useBucketSearchQuery } from "../../api/buckets";
import {
  useCategorizeInboxMutation,
  type InboxCategoryTarget,
} from "../../api/inbox";
import { createContext } from "../../lib/create-context";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { AnimatedHeight } from "../../ui/animated-height/animated-height";
import { useInboxUndo } from "./inbox-undo-context";

const [useBucketCombo, BucketComboContext] =
  createContext<(rowId: string, anchor: HTMLButtonElement) => void>();

const categoryKinds = [
  { kind: "expense", name: "Expense" },
  { kind: "income", name: "Income" },
  { kind: "person", name: "Person" },
] as const;
const categoryKindValues = categoryKinds.map(({ kind }) => kind);

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
  const { mutateAsync } = useCategorizeInboxMutation();
  const undo = useInboxUndo();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<BucketComboSession | null>(null);
  const [input, setInput] = useState("");
  const search = input.trim();
  const query = useDebouncedValue(search, 50);
  const bucketsQuery = useBucketSearchQuery(query, categoryKindValues);

  const groups: BucketComboGroup[] = [];
  if (bucketsQuery.data) {
    const buckets = bucketsQuery.data.filter(
      (bucket) =>
        !bucket.hidden &&
        categoryKinds.some(({ kind }) => kind === bucket.kind),
    );
    if (buckets.length) {
      groups.push({
        id: "buckets",
        name: "Categorize as…",
        items: buckets.map((bucket) => ({
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
    if (
      search === query &&
      search &&
      !exactMatch &&
      !bucketsQuery.isPlaceholderData &&
      !bucketsQuery.isPending &&
      !bucketsQuery.isError
    ) {
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
            className="z-10 outline-none"
          >
            <Combobox.Popup
              className="min-w-48 max-w-(--available-width,100vw) origin-(--transform-origin) overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-900 shadow-float transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:duration-[1ms]"
              aria-label="Choose category, person, or action"
              aria-busy={bucketsQuery.isFetching || undefined}
            >
              <Combobox.Input
                className="h-9 w-full border-b border-popover-border bg-transparent px-3 font-[inherit] text-gray-900 outline-none placeholder:text-gray-600/70 [@media(any-pointer:coarse)]:text-md"
                placeholder="Filter actions..."
                aria-label="Filter categories, people, and actions"
              />

              <AnimatedHeight>
                <div className="max-h-[max(calc(2rem*2.5),calc(2rem*1.5+round(down,var(--cap)-2rem*1.5,2rem)))] scroll-py-1 overflow-y-auto overscroll-contain pb-1 [--cap:min(calc(var(--available-height,100vh)-calc(2rem+var(--spacing))),22rem)] [scrollbar-color:var(--color-gray-300)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:bg-clip-content">
                  <Combobox.Status>
                    {bucketsQuery.isPending ? (
                      <div className="flex min-h-8 items-center px-3 text-gray-600">
                        Loading…
                      </div>
                    ) : bucketsQuery.isError ? (
                      <div className="flex min-h-8 items-center px-3 text-gray-600">
                        Error loading buckets
                      </div>
                    ) : null}
                  </Combobox.Status>

                  <Combobox.Empty>
                    {!bucketsQuery.isPending && !bucketsQuery.isError ? (
                      <div className="p-4 text-center text-gray-600">
                        No matches
                      </div>
                    ) : null}
                  </Combobox.Empty>

                  <Combobox.List className="outline-none">
                    {(group: BucketComboGroup) => (
                      <Combobox.Group
                        key={group.id}
                        items={group.items}
                        className="[&+&]:mt-1 [&+&]:border-t [&+&]:border-popover-border"
                      >
                        <Combobox.GroupLabel className="flex h-8 items-center px-3 text-base text-gray-600">
                          {group.name}
                        </Combobox.GroupLabel>
                        <Combobox.Collection>
                          {(item: BucketComboItem) => (
                            <Combobox.Item
                              key={item.id}
                              value={item}
                              className="mx-1 flex h-8 cursor-default items-center gap-2 rounded-lg px-3 text-gray-900 outline-none select-none data-highlighted:bg-popover-item-selected data-selected:bg-popover-item-selected"
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
