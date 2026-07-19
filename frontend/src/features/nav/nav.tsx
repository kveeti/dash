import { Combobox } from "@base-ui/react/combobox";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

const pages = [
  { label: "inbox", href: "/inbox" },
  { label: "transactions", href: "/transactions" },
  { label: "stats", href: "/stats" },
  { label: "import", href: "/imports" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 h-(--nav-height) bg-gray-125/80 backdrop-blur-md sm:sticky sm:top-0 pl-(--scrollbar-pl)">
      <div className="mx-auto flex h-full max-w-(--page-width) px-3">
        <ul className="flex list-none">
          {pages.map((page) => (
            <li key={page.href}>
              <ImmediateNavLink href={page.href}>{page.label}</ImmediateNavLink>
            </li>
          ))}
        </ul>
      </div>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </nav>
  );
}

function ImmediateNavLink(props: { href: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const isLocal = () =>
    new URL(props.href, window.location.href).origin === window.location.origin;

  return (
    <Link
      href={props.href}
      className={(isActive) =>
        `inline-flex h-full items-center px-3 text-base text-inherit no-underline outline-none ${isActive ? "underline" : ""} hover:bg-gray-200/80 focus-visible:rounded-none focus-visible:outline-offset-[-1.5px]`
      }
      onClick={(event) => {
        if (
          isLocal() &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
        }
      }}
      onMouseDown={(event) => {
        if (
          isLocal() &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
      onTouchStart={(event) => {
        if (
          isLocal() &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
      onKeyUp={(event) => {
        if (
          isLocal() &&
          (event.key === "Enter" ||
            event.key === " " ||
            event.key === "Space") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
    >
      {props.children}
    </Link>
  );
}

function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");

  function go(href: string) {
    props.onOpenChange(false);
    navigate(href);
  }

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setInput("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-20 bg-black/5 transition-opacity duration-180 ease-[cubic-bezier(.16,1,.3,1)] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-[cubic-bezier(.4,0,1,1)] data-starting-style:opacity-0 motion-reduce:duration-[1ms]" />
        <Dialog.Popup className="fixed top-[20vh] left-1/2 z-21 flex w-[min(28rem,calc(100vw-1rem))] -translate-x-1/2 origin-top flex-col overflow-hidden rounded-xl border border-popover-border bg-popover text-base text-gray-1000 shadow-float transition-[opacity,scale] duration-240 ease-[cubic-bezier(.16,1,.3,1)] data-ending-style:scale-[.97] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[.97] data-starting-style:opacity-0 motion-reduce:duration-[1ms]">
          <Dialog.Title className="sr-only">Go to page</Dialog.Title>

          <Combobox.Root<(typeof pages)[number]>
            items={pages}
            value={null}
            inline
            open
            inputValue={input}
            autoHighlight
            itemToStringLabel={(page) => page.label}
            onInputValueChange={(nextValue, details) => {
              if (details.reason !== "item-press") setInput(nextValue);
            }}
            onValueChange={(page) => {
              if (page) go(page.href);
            }}
          >
            <Combobox.Input
              className="h-9 w-full rounded-none border-b border-popover-border bg-transparent px-3 font-[inherit] text-gray-900 outline-none placeholder:text-gray-600/70 [@media(any-pointer:coarse)]:text-md"
              placeholder="Search…"
              aria-label="Search pages"
            />
            <Combobox.Empty>
              <p className="p-4 text-center text-gray-600">No results.</p>
            </Combobox.Empty>
            <Combobox.List className="scroll-py-1 overflow-y-auto overscroll-contain py-1 outline-none">
              {(page: (typeof pages)[number]) => (
                <Combobox.Item
                  key={page.href}
                  value={page}
                  className="mx-1 flex h-8 cursor-default select-none items-center rounded-lg px-3 capitalize outline-none data-highlighted:bg-popover-item-selected data-selected:bg-popover-item-selected"
                >
                  {page.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
