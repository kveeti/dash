import { XCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

import { Button } from "../../ui/button/button";
export function SelectionCountButton(props: {
  count: number;
  onClick: () => void;
}) {
  return (
    <Button onClick={props.onClick} variant="ghost" className="!px-2">
      <XCircleIcon className="size-4" />
      <span className="whitespace-nowrap text-sm text-gray-700 tabular-nums">
        {props.count} selected
      </span>
    </Button>
  );
}
export function CloseButton(props: { onClick: () => void }) {
  return (
    <Button
      aria-label="Close selection"
      onClick={props.onClick}
      variant="ghost"
      className="w-9 shrink-0 !px-2"
    >
      <XMarkIcon className="size-3.5 shrink-0" strokeWidth={2} />
    </Button>
  );
}
export function FloatingBarWrap(props: { show: boolean; children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-[calc(var(--nav-height)+var(--filterbar-height))] z-3 p-1 opacity-100 transition-[opacity,visibility] [transition-duration:80ms,0ms] data-[visible=false]:invisible data-[visible=false]:opacity-0 data-[visible=false]:[transition-delay:0ms,100ms] data-[visible=false]:[transition-duration:100ms,0ms] sm:bottom-0 sm:p-3"
      data-visible={props.show}
      inert={!props.show}
    >
      <div
        className="mx-auto flex w-full max-w-[calc(var(--page-width)+2rem)] translate-y-0 items-center gap-2 rounded-[1.25rem] border border-popover-border bg-popover p-2 shadow-float transition-[translate] duration-420 ease-[cubic-bezier(.22,1.55,.36,1)] data-[show=false]:translate-y-6 data-[show=false]:delay-100 data-[show=false]:duration-0 data-[show=false]:ease-in-out motion-reduce:translate-y-0 motion-reduce:transition-none"
        data-show={props.show}
      >
        {props.children}
      </div>
    </div>
  );
}
