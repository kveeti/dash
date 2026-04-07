import type { ReactNode } from "react";
import { FastLink } from "./components/link";
import { CommandPalette } from "./components/command-palette";
import { useRoute } from "wouter";
import { useSync } from "./lib/use-sync";

export function Layout(props: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[800px]">
      <Nav />
      <CommandPalette />

      {props.children}
    </div>
  );
}

export function Nav() {
  return (
    <nav
      className={
        "font-mono bg-gray-1 right-0 left-0 flex h-10 items-center shadow-xs sm:top-0 sm:border-t-0 sm:border-b" +
        " pwa:pb-10 pwa:sm:pb-0 border-gray-a4 fixed bottom-0 h-max border-t px-4 shadow-xs" +
        " me-(--removed-body-scroll-bar-size)"
      }
    >
      <ul className="mx-auto flex w-full max-w-[800px] justify-between text-xs">
        <div className="flex">
          <li>
            <NavLink href="/stats">stats</NavLink>
          </li>
          <li>
            <NavLink href="/txs">txs</NavLink>
          </li>
          <li>
            <NavLink href="/txs/new">add txs</NavLink>
          </li>
          <li>
            <NavLink href="/cats">cats</NavLink>
          </li>
        </div>
        <div className="flex">
          <li>
            <SyncNavLink />
          </li>
        </div>
      </ul>
    </nav>
  );
}

const syncDotColors = {
  idle: "bg-green-9",
  syncing: "bg-yellow-9",
  error: "bg-red-9",
  locked: "bg-gray-8",
  unconfigured: "bg-gray-8",
} as const;

function SyncNavLink() {
  const [isActive] = useRoute("/sync");
  const { status } = useSync();

  let extras = "";
  if (isActive) extras += " bg-gray-a3";

  return (
    <FastLink
      className={
        "hover:bg-gray-a3 focus flex h-10 items-center justify-center gap-1.5 px-3 -outline-offset-2" +
        extras
      }
      href="/sync"
    >
      <span className={`inline-block size-1.5 rounded-full ${syncDotColors[status]}`} />
      sync
    </FastLink>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [isActive] = useRoute(href);

  let extras = "";
  if (isActive) {
    extras += " bg-gray-a3";
  }

  return (
    <FastLink
      className={
        "hover:bg-gray-a3 focus flex h-10 items-center justify-center px-3 -outline-offset-2" +
        extras
      }
      href={href}
    >
      {children}
    </FastLink>
  );
}

