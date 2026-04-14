import type { ReactNode } from "react";
import { FastLink } from "./components/link";
import { CommandPalette } from "./components/command-palette";
import { useRoute } from "wouter";
import { useSync } from "./lib/sync";

export function Layout(props: { children: ReactNode }) {
  useSync()

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
        " pwa:pb-10 pwa:sm:pb-0 border-gray-a4 fixed bottom-0 h-max border-t px-4 shadow-xs z-50" +
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
      </ul>
    </nav>
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

