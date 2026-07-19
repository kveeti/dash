import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";

import { AnimatedHeight } from "../../ui/animated-height/animated-height";
import { inputTriggerClassName } from "../../ui/input/input-styles";

type TagItem =
  | { type: "tag"; id: string; name: string; value: string }
  | { type: "create"; id: string; name: string; value: string };

export function TagCombobox(props: {
  tags: string[];
  onChange: (tag: string) => void;
  className?: string;
}) {
  const { contains } = Combobox.useFilter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const tag = input.trim().toLowerCase();

  const items: TagItem[] = [];
  const matching = tag
    ? props.tags.filter((value) => contains(value, tag))
    : props.tags;
  for (const value of matching) {
    items.push({ type: "tag", id: value, name: `#${value}`, value });
  }
  if (tag && !props.tags.includes(tag)) {
    items.push({
      type: "create",
      id: "create",
      name: `Create #${tag}`,
      value: tag,
    });
  }

  return (
    <div className={props.className}>
      <Combobox.Root<TagItem>
        items={items}
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
          if (item) props.onChange(item.value);
        }}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) setInput("");
        }}
      >
        <Combobox.Trigger className={inputTriggerClassName}>
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--input-placeholder)">
            Tag…
          </span>
        </Combobox.Trigger>

        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={6}
            className="z-10 outline-none"
          >
            <Combobox.Popup
              className="max-w-[var(--available-width,100vw)] min-w-48 origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-900 shadow-float transition-[opacity,scale] duration-150 ease-[cubic-bezier(.16,1,.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(.4,0,1,1)] motion-reduce:duration-[1ms]"
              aria-label="Add tag"
            >
              <Combobox.Input
                className="h-9 w-full rounded-none border-b border-popover-border bg-transparent px-3 text-gray-900 outline-none placeholder:text-gray-600/70 [@media(any-pointer:coarse)]:text-md"
                placeholder="Find or create tag"
                aria-label="Find or create tag"
              />

              <AnimatedHeight>
                <div className="[--cap:min(calc(var(--available-height,100vh)-calc(2rem+var(--spacing))),22rem)] [max-block-size:max(calc(1.5rem),calc(1.5rem+round(down,var(--cap)-1.5rem,1.5rem)))] scroll-py-1 overflow-y-auto overscroll-contain py-1 [scrollbar-color:var(--gray-350)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-gray-350 [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar]:w-2">
                  <Combobox.Empty>
                    <div className="p-4 text-center text-gray-600">No tags</div>
                  </Combobox.Empty>

                  <Combobox.List className="outline-none">
                    {(item: TagItem) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        className="mx-1 flex h-6 cursor-default items-center gap-2 rounded-sm px-3 text-gray-900 outline-none select-none data-highlighted:bg-popover-item-selected data-selected:bg-popover-item-selected"
                      >
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
  );
}
