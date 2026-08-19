import { Combobox } from "@base-ui/react";
import { useState } from "react";

import {
  useAddTransactionTagMutation,
  useRemoveTransactionTagMutation,
  useTagsQuery,
  type Posting,
} from "../../../api/transactions";
import { useDebouncedValue } from "../../../lib/use-debounced-value";
import { useLastSettledValue } from "../../../lib/use-last-settled-value";
import { AnimatedHeight } from "../../../ui/animated-height/animated-height";
import { Checkbox } from "../../../ui/checkbox/checkbox";
import { Field } from "../../../ui/input/field";
import { PopupSearchInput } from "../../../ui/input/search-input";
import type { TagActionItem, TagState } from "../transaction-action-types";

export function TagsField(props: { posting: Posting }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const debouncedInput = useDebouncedValue(input, 50);

  const tags = useTagComboboxState({
    search: input,
    query: debouncedInput,
    selectedItems: [props.posting],
  });

  return (
    <Field label="Tags" as="div">
      <div className="w-full">
        <Combobox.Root<TagActionItem, true>
          items={tags.items}
          value={props.posting.tags.map((t) => ({
            type: "tag" as const,
            id: "tag:" + t,
            name: "#" + t,
            value: t,
            creatable: false,
            state: "all" as const,
          }))}
          multiple
          open={isOpen}
          inputValue={input}
          autoHighlight
          filter={null}
          onValueChange={(value) => {
            tags.change(value);
            setIsOpen(false);
          }}
          onInputValueChange={(input, details) => {
            if (details.reason === "item-press") return;
            setInput(input);
          }}
          isItemEqualToValue={(a, b) => a.value === b.value}
          onOpenChange={setIsOpen}
        >
          <Combobox.Trigger
            className="flex min-h-9 w-full flex-wrap items-center gap-2 rounded-xl text-left outline-2 outline-transparent outline-offset-2 focus-visible:outline-gray-500"
            aria-label="Tags"
          >
            <Combobox.Chips className="flex flex-wrap items-center gap-2">
              <Combobox.Value>
                {(value: TagActionItem[]) =>
                  value.length ? (
                    value.map((tag) => (
                      <Combobox.Chip
                        key={tag.id}
                        className="rounded-full bg-gray-200 hover:bg-gray-310 px-2.5 py-1 text-sm text-gray-800"
                      >
                        #{tag.value}
                      </Combobox.Chip>
                    ))
                  ) : (
                    <span className="text-(--input-placeholder)">
                      Add tags…
                    </span>
                  )
                }
              </Combobox.Value>
            </Combobox.Chips>
          </Combobox.Trigger>

          <Combobox.Portal>
            <Combobox.Positioner
              align="start"
              sideOffset={6}
              className="z-10 outline-none"
            >
              <Combobox.Popup
                className="min-w-56 max-w-(--available-width,100vw) origin-(--transform-origin) overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-900 shadow-float transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:duration-[1ms]"
                aria-label="Select tags"
                aria-busy={tags.isFetching || undefined}
              >
                <Combobox.Input
                  render={<PopupSearchInput />}
                  placeholder="Change or add tags..."
                  aria-label="Change or add tags..."
                />

                <AnimatedHeight>
                  <div className="max-h-[max(calc(2rem*2.5),calc(2rem*1.5+round(down,var(--cap)-2rem*1.5,2rem)))] scroll-py-1 overflow-y-auto overscroll-contain py-1 [--cap:min(calc(var(--available-height,100vh)-calc(2rem+var(--spacing))),22rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <Combobox.Status>
                      {tags.isPending ? (
                        <div className="flex min-h-8 items-center px-3 text-gray-600">
                          Loading…
                        </div>
                      ) : tags.error ? (
                        <div className="flex min-h-8 items-center px-3 text-gray-600">
                          Error loading tags
                        </div>
                      ) : null}
                    </Combobox.Status>
                    <Combobox.Empty>
                      {!tags.isPending && !tags.error ? (
                        <div className="p-4 text-center text-gray-600">
                          No tags
                        </div>
                      ) : null}
                    </Combobox.Empty>
                    <Combobox.List className="outline-none">
                      {(item: TagActionItem) => (
                        <Combobox.Item
                          key={item.id}
                          value={item}
                          className="mx-1 flex h-8 cursor-default items-center gap-2 rounded-lg px-3 text-gray-900 outline-none select-none data-highlighted:bg-popover-item-selected"
                          onClick={(event) => {
                            if (
                              item.type === "tag" &&
                              event.target instanceof Element &&
                              event.target.closest("[data-tag-checkbox]")
                            ) {
                              event.preventBaseUIHandler();
                              tags.toggle(item);
                            }
                          }}
                        >
                          {item.type === "tag" ? (
                            <span
                              className="-m-2 flex cursor-pointer p-2"
                              data-tag-checkbox
                            >
                              <Checkbox
                                className="pointer-events-none"
                                checked={item.state === "all"}
                                indeterminate={item.state === "some"}
                                tabIndex={-1}
                                aria-label={`${item.state === "all" ? "Remove" : "Add"} tag #${item.value} ${item.state === "all" ? "from" : "to"} selected transactions`}
                              />
                            </span>
                          ) : null}
                          <span>{item.name}</span>
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </div>
                </AnimatedHeight>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
    </Field>
  );
}

export function useTagComboboxState(props: {
  search: string;
  query: string;
  selectedItems?: { id: string; tags: string[] }[];
}) {
  const selectedItems = props.selectedItems ?? [];

  const search = props.search.toLocaleLowerCase();
  const query = props.query.toLocaleLowerCase();
  const tagsQuery = useTagsQuery(query);

  const retainedTags = useRetainedTags([]);

  const serverTags = tagsQuery.data?.tags ?? [];
  const localTags = [
    ...new Set([
      ...selectedItems.flatMap((item) => item.tags),
      ...retainedTags.tags,
    ]),
  ].filter((tag) => !search || tag.toLocaleLowerCase().includes(search));
  const tags = [...new Set([...serverTags, ...localTags])].sort();

  const settled =
    search === query &&
    !tagsQuery.isPlaceholderData &&
    !tagsQuery.isFetching &&
    !tagsQuery.isError;
  const currentTags = tags.map((tag) => ({ value: tag, create: false }));
  if (settled && search && !tags.includes(search)) {
    currentTags.push({ value: search, create: true });
  }
  const displayedTags = useLastSettledValue(currentTags, settled);
  const items: TagActionItem[] = displayedTags.map((tag) => {
    const tagged = selectedItems.filter((item) =>
      item.tags.includes(tag.value),
    ).length;
    let tagState: TagState;
    if (tagged === 0) tagState = "none";
    else if (tagged === selectedItems.length) tagState = "all";
    else tagState = "some";

    return {
      type: "tag" as const,
      id: `tag:${tag.value}`,
      name: tag.create ? `Create #${tag.value}` : `#${tag.value}`,
      value: tag.value,
      state: tagState,
      creatable: tag.create,
    };
  });

  const addTag = useAddTransactionTagMutation();
  const removeTag = useRemoveTransactionTagMutation();

  function toggle(item: TagActionItem) {
    retainedTags.addItem(item.value);
    if (item.state === "all") {
      removeTag.mutate({
        ids: selectedItems.map((item) => item.id),
        value: item.value,
      });
    } else {
      addTag.mutate({
        ids: selectedItems.map((item) => item.id),
        value: item.value,
      });
    }
  }

  function change(next: TagActionItem[]) {
    const creatableSelection = next.find(
      (item) => typeof item !== "string" && item.creatable,
    ) as TagActionItem | undefined;
    const selectedIds = selectedItems.map((item) => item.id);

    if (creatableSelection) {
      addTag.mutate({ ids: selectedIds, value: creatableSelection.value });
      return;
    }

    const currentTags = items.filter((i) => i.state === "all");

    const added = next.find(
      (tag) => !currentTags.find((ct) => ct.value === tag.value),
    );
    if (added) {
      addTag.mutate({ ids: selectedIds, value: added.value });
    } else {
      const removed = currentTags.find(
        (tag) => !next.find((t) => t.value === tag.value),
      );
      if (removed) removeTag.mutate({ ids: selectedIds, value: removed.value });
    }
  }

  return {
    items,
    toggle,
    change,
    isFetching: tagsQuery.isFetching,
    isPending: tagsQuery.isPending,
    error: tagsQuery.error,
  };
}
export function useRetainedTags(initialState: string[] = []) {
  const [state, setState] = useState(initialState);

  function addItem(item: string) {
    if (state.includes(item)) {
      return;
    }

    setState((prev) => [...prev, item]);
  }

  function removeItem(item: string) {
    setState((prev) => prev.filter((i) => i !== item));
  }

  return { tags: state, addItem, removeItem };
}
