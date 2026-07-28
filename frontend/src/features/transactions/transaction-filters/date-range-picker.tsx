import { Combobox } from "@base-ui/react/combobox";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import { AnimatedHeight } from "../../../ui/animated-height/animated-height";
import { InputTrigger, PopupSearchInput } from "../../../ui/input/input";
import { dateRanges, type DateRange } from "./date-range";

export function DateRangePicker(props: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const selected = dateRanges.find((item) => item.value === props.range)!;

  return (
    <Combobox.Root<(typeof dateRanges)[number]>
      items={dateRanges}
      value={selected}
      open={open}
      inputValue={input}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setInput("");
      }}
      onInputValueChange={(value, details) => {
        if (details.reason !== "item-press") setInput(value);
      }}
      onValueChange={(value) => {
        if (!value) return;
        props.onChange(value.value);
        setOpen(false);
      }}
    >
      <Combobox.Trigger
        render={<InputTrigger />}
        aria-label="Quick select"
        className="mt-1"
      >
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {selected.label}
        </span>
        <Combobox.Icon className="flex text-gray-600">
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={6}
          className="z-20 outline-none"
        >
          <Combobox.Popup className="min-w-56 max-w-(--available-width,100vw) origin-(--transform-origin) overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-900 shadow-float transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:duration-[1ms]">
            <Combobox.Input
              render={<PopupSearchInput />}
              placeholder="Filter date ranges…"
              aria-label="Filter date ranges"
            />
            <AnimatedHeight>
              <div className="max-h-64 scroll-py-1 overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Combobox.Empty>
                  <div className="p-4 text-center text-gray-600">
                    No matches
                  </div>
                </Combobox.Empty>
                <Combobox.List className="outline-none">
                  {(item) => (
                    <Combobox.Item
                      key={item.value}
                      value={item}
                      className="mx-1 flex h-8 cursor-default items-center rounded-lg px-3 text-gray-900 outline-none select-none data-highlighted:bg-popover-item-selected data-selected:bg-popover-item-selected"
                    >
                      {item.label}
                    </Combobox.Item>
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
