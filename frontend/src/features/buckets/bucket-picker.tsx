import { Combobox } from "@base-ui/react/combobox";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import {
  useBucketSearchQuery,
  useCreateBucketMutation,
  type Bucket,
  type BucketKind,
} from "../../api/buckets";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useLastSettledValue } from "../../lib/use-last-settled-value";
import { AnimatedHeight } from "../../ui/animated-height/animated-height";
import { InputTrigger, PopupSearchInput } from "../../ui/input/input";

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
  className?: string;
  kinds: BucketKind[];
  createKinds?: BucketKind[];
  value?: Bucket | null;
  onPick: (bucket: Bucket) => void;
  placeholder?: string;
  inputPlaceholder?: string;
  groupLabel?: string;
}) {
  const createBucket = useCreateBucketMutation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const search = input.trim();
  const query = useDebouncedValue(search, 50);
  const bucketsQuery = useBucketSearchQuery(query, props.kinds);
  const settled =
    search === query &&
    !bucketsQuery.isPlaceholderData &&
    !bucketsQuery.isFetching &&
    !bucketsQuery.isError;

  const currentGroups: PickerGroup[] = [];
  if (bucketsQuery.data) {
    const buckets = bucketsQuery.data.filter(
      (bucket) => !bucket.hidden && props.kinds.includes(bucket.kind),
    );
    if (buckets.length) {
      currentGroups.push({
        id: "buckets",
        name: props.groupLabel ?? "Choose…",
        items: buckets.map((bucket) => ({
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
    if (settled && search && !exactMatch && createKinds.length) {
      currentGroups.push({
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

  const groups = useLastSettledValue(currentGroups, settled);

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
      <Combobox.Trigger render={<InputTrigger />} className={props.className}>
        <span
          className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${props.value ? "" : "text-(--input-placeholder)"}`}
        >
          {props.value ? props.value.name : (props.placeholder ?? "Select…")}
        </span>
        <Combobox.Icon className="flex text-gray-600">
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={6}
          className="z-10 outline-none"
        >
          <Combobox.Popup
            className="min-w-48 max-w-(--available-width,100vw) origin-(--transform-origin) overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-900 shadow-float transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:duration-[1ms]"
            aria-busy={bucketsQuery.isFetching || undefined}
          >
            <Combobox.Input
              render={<PopupSearchInput className="h-10" />}
              placeholder={
                props.inputPlaceholder ?? props.placeholder ?? "Search…"
              }
              aria-label="Filter buckets"
            />

            <AnimatedHeight>
              <div className="max-h-[max(calc(2rem*2.5),calc(2rem*1.5+round(down,var(--cap)-2rem*1.5,2rem)))] scroll-py-1 overflow-y-auto overscroll-contain pb-1 [--cap:min(calc(var(--available-height,100vh)-calc(2rem+var(--spacing))),22rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                  {(group: PickerGroup) => (
                    <Combobox.Group
                      key={group.id}
                      items={group.items}
                      className="[&+&]:mt-1 [&+&]:border-t [&+&]:border-popover-border"
                    >
                      <Combobox.GroupLabel className="flex h-8 items-center px-3 text-base text-gray-600">
                        {group.name}
                      </Combobox.GroupLabel>
                      <Combobox.Collection>
                        {(item: PickerItem) => (
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
  );
}
