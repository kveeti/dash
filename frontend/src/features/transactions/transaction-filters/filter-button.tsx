import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { ArrowUturnLeftIcon, FunnelIcon } from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode } from "react";

import { setSearchParams } from "../../../lib/search-param";

export function FilterButton(props: {
  appliedCount: number;
  children: ReactNode;
}) {
  return (
    <Popover.Root
      // NOTE: Focus trap is not enabled unless Popover.Close
      // is rendered (sr-only is enough)
      modal="trap-focus"
    >
      <Popover.Trigger
        className={`relative grid size-9 shrink-0 place-items-center rounded-xl border border-transparent outline-[1.5px] outline-transparent outline-offset-[-1px] focus-visible:outline-gray-500 data-popup-open:bg-popover-item-selected data-popup-open:text-gray-950 ${props.appliedCount ? "bg-popover-item-selected text-gray-950" : "text-gray-700 hover:bg-popover-item-selected"}`}
        aria-label={
          props.appliedCount
            ? `Filters, ${props.appliedCount} sections applied`
            : "Filters"
        }
      >
        <FunnelIcon className="size-4" aria-hidden="true" />
        {props.appliedCount > 0 && (
          <span
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-gray-900 text-[0.6rem] font-semibold text-white"
            aria-hidden="true"
          >
            {props.appliedCount}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={8}
          className="z-10 outline-none"
        >
          <Popover.Popup className="flex h-[min(24rem,calc(var(--available-height,100vh)-1rem))] w-[min(36rem,calc(100vw-1.5rem))] origin-(--transform-origin) overflow-hidden rounded-2xl border border-popover-border bg-popover text-gray-900 shadow-float outline-none transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] [--input-bg:var(--input-bg-popover)] [--input-bg-alt:var(--input-bg-alt-popover)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.98] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(0.4,0,1,1)] motion-reduce:duration-[1ms]">
            <Tabs.Root
              defaultValue="amount"
              orientation="vertical"
              className="flex min-h-0 w-full flex-col-reverse sm:flex-row"
            >
              {props.children}
            </Tabs.Root>

            <Popover.Close className="sr-only">Close</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TabsList(props: { children: ReactNode }) {
  return (
    <Tabs.List className="bg-gray-90 flex shrink-0 gap-1 overflow-x-auto border-t border-popover-border p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-40 sm:flex-col sm:overflow-visible sm:border-r sm:border-t-0">
      {props.children}
    </Tabs.List>
  );
}

export function TabContent(props: { showClear: boolean; children: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {props.showClear && (
        <button
          type="button"
          aria-label="Clear filters"
          title="Clear filters"
          className="absolute end-3 top-3 z-1 grid size-8 place-items-center rounded-lg text-gray-700 outline-[1.5px] outline-transparent outline-offset-[-1px] hover:bg-popover-item-selected focus-visible:outline-gray-500"
          onClick={() =>
            setSearchParams(
              {
                direction: undefined,
                amount: undefined,
                amount_min: undefined,
                amount_max: undefined,
                currency: undefined,
                category: undefined,
                tag: undefined,
                account: undefined,
                range: undefined,
                start: undefined,
                end: undefined,
              },
              { replace: true },
            )
          }
        >
          <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
        </button>
      )}
      {props.children}
    </div>
  );
}

export function TabPanel(props: { value: string; children: ReactNode }) {
  return (
    <Tabs.Panel value={props.value} className="outline-none" tabIndex={-1}>
      {props.children}
    </Tabs.Panel>
  );
}

export function TabTrigger(props: {
  value: string;
  label: string;
  Icon: ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  applied: boolean;
}) {
  return (
    <Tabs.Tab
      value={props.value}
      className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-sm text-gray-700 outline-[1.5px] outline-transparent outline-offset-[-1px] hover:bg-popover-item-selected focus-visible:bg-popover-item-selected focus-visible:text-gray-950 focus-visible:outline-gray-500 data-active:bg-popover-item-selected data-active:text-gray-950 sm:w-full"
    >
      <props.Icon className="size-4" aria-hidden="true" />
      <span>{props.label}</span>
      {props.applied && (
        <span
          className="ms-auto size-1.5 shrink-0 rounded-full bg-success-solid"
          aria-hidden="true"
        />
      )}
    </Tabs.Tab>
  );
}
