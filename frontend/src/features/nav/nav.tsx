import { Combobox } from "@base-ui/react/combobox";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { ArrowPathIcon, Bars3Icon } from "@heroicons/react/24/outline";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import {
  useEnableBankingConnections,
  useEnableBankingSyncStatus,
  useSyncEnableBankingAccounts,
} from "../../api/enablebanking";
import { PopupSearchInput } from "../../ui/input/input";

const pages = [
  { label: "inbox", href: "/inbox" },
  { label: "transactions", href: "/transactions" },
  { label: "stats", href: "/stats" },
  { label: "import", href: "/imports" },
  { label: "banks", href: "/connections" },
];

const navPages = pages.filter(
  (page) => page.href !== "/imports" && page.href !== "/connections",
);
const menuPages = pages.filter(
  (page) => page.href === "/imports" || page.href === "/connections",
);

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
    <nav className="fixed inset-x-0 bottom-0 z-10 h-(--nav-height) bg-gray-125/80 backdrop-blur-md sm:sticky sm:top-0 sm:pl-(--scrollbar-pl)">
      <div className="mx-auto flex h-full w-full min-w-0 max-w-(--page-width) justify-between px-1 min-[18rem]:px-3">
        <ul className="flex list-none">
          {navPages.map((page) => (
            <li key={page.href}>
              <ImmediateNavLink href={page.href}>{page.label}</ImmediateNavLink>
            </li>
          ))}
        </ul>
        <NavMenu />
      </div>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </nav>
  );
}

function NavMenu() {
  const connections = useEnableBankingConnections();
  const syncStatus = useEnableBankingSyncStatus();
  const sync = useSyncEnableBankingAccounts();
  const accounts = (connections.data ?? []).flatMap((connection) =>
    connection.accounts.flatMap((account) =>
      account.bucket_id
        ? [{ connectionId: connection.id, accountUid: account.uid }]
        : [],
    ),
  );

  return (
    <Menu.Root>
      <Menu.Trigger
        className="inline-flex h-full items-center px-2 text-gray-900 outline-2 outline-transparent outline-offset-[-2px] hover:bg-gray-200/80 focus-visible:outline-(--input-ring-active) min-[18rem]:px-3"
        aria-label="Open menu"
      >
        <Bars3Icon className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          className="z-20 outline-none"
        >
          <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-xl border border-popover-border bg-popover p-1 text-base text-gray-900 shadow-float outline-none transition-[opacity,scale] duration-150 ease-[cubic-bezier(.16,1,.3,1)] data-ending-style:scale-[.97] data-ending-style:opacity-0 data-starting-style:scale-[.97] data-starting-style:opacity-0 motion-reduce:duration-[1ms]">
            {menuPages.map((page) => (
              <Menu.LinkItem
                key={page.href}
                render={<Link href={page.href} />}
                closeOnClick
                className="flex h-9 cursor-default items-center rounded-lg px-3 capitalize no-underline outline-none data-highlighted:bg-popover-item-selected"
              >
                {page.label}
              </Menu.LinkItem>
            ))}
            {accounts.length > 0 && (
              <>
                <Menu.Separator className="my-1 h-px bg-popover-border" />
                <Menu.Item
                  closeOnClick={false}
                  className="flex h-9 cursor-default items-center gap-2 rounded-lg px-3 outline-none data-highlighted:bg-popover-item-selected"
                  onClick={() => {
                    if (!sync.isPending && !syncStatus.data?.syncing)
                      sync.mutate(accounts);
                  }}
                >
                  <ArrowPathIcon
                    className={`size-3.5 ${syncStatus.data?.syncing ? "motion-safe:animate-spin" : ""}`}
                    data-sync-icon
                    aria-hidden="true"
                  />
                  Sync all
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
        `inline-flex h-full items-center px-1.5 text-sm text-inherit no-underline outline-2 outline-transparent outline-offset-[-2px] min-[18rem]:px-3 min-[18rem]:text-base ${isActive ? "underline" : ""} hover:bg-gray-200/80 focus-visible:rounded-none focus-visible:outline-(--input-ring-active)`
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
              render={<PopupSearchInput />}
              placeholder="Search…"
              aria-label="Search pages"
            />
            <Combobox.Empty>
              <p className="p-4 text-center text-gray-600">No results.</p>
            </Combobox.Empty>
            <Combobox.List className="scroll-py-1 overflow-y-auto overscroll-contain py-1 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
