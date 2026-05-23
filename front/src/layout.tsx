import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { Button } from "./components/button";
import * as Dropdown from "./components/dropdown";
import { FastLink, SlowLink } from "./components/link";
import { CommandPalette, CommandPaletteV2 } from "./components/command-palette";
import { useRoute } from "wouter";
import { useSync } from "./lib/sync";
import { TransactionWindowsProvider } from "./components/transaction-windows";

export function Layout(props: { children: ReactNode }) {
  useSync();

  return (
    <TransactionWindowsProvider>
      <Nav />
      <CommandPalette />
      <CommandPaletteV2 />
      <main className="pt-12 pb-10">{props.children}</main>
    </TransactionWindowsProvider>
  );
}

export function Nav() {
  return (
    <nav
      className={
        "bg-gray-1/95 backdrop-blur supports-[backdrop-filter]:bg-gray-1/80 fixed top-0 right-0 left-0 z-50 flex h-12 items-center border-b border-gray-a3" +
        " pwa:pt-[env(safe-area-inset-top)] me-(--removed-body-scroll-bar-size)"
      }
    >
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-4 px-4 sm:px-6">
        <FastLink
          href="/stats"
          className="focus flex items-center gap-2 text-gray-12 select-none -ml-1 px-1 rounded-sm"
        >
          <Wordmark />
        </FastLink>

        <ul className="flex items-center">
          <li>
            <NavLink href="/stats">Stats</NavLink>
          </li>
          <li>
            <NavLink href="/txs">Transactions</NavLink>
          </li>
          <li>
            <NavLink href="/txs/review">Review</NavLink>
          </li>
          <li>
            <NavLink href="/txs/new">Import</NavLink>
          </li>
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <CommandPaletteHint />
          <Hamburger />
        </div>
      </div>
    </nav>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-1.5 text-[13px] font-medium tracking-[-0.01em]">
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-gray-12" />
      dash
    </span>
  );
}

function CommandPaletteHint() {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        );
      }}
      className="focus border border-gray-a3 rounded-md hover:border-gray-a5 hover:bg-gray-a2 transition-colors hidden sm:flex h-7 items-center gap-2 pl-2.5 pr-1.5 text-[12px] text-gray-10"
      aria-label="Open command palette"
    >
      <span>Jump to…</span>
      <kbd className="kbd-key">⌘K</kbd>
    </button>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [isActive] = useRoute(href);

  return (
    <FastLink
      className={
        "focus relative flex h-12 items-center px-3 text-[13px] outline-none transition-colors " +
        (isActive
          ? "text-gray-12 after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-gray-12"
          : "text-gray-11 hover:text-gray-12")
      }
      href={href}
    >
      {children}
    </FastLink>
  );
}

function Hamburger() {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label="More">
          <HamburgerMenuIcon />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Content align="end">
        <Dropdown.Item asChild>
          <SlowLink href="/txs/link-suggestions">Link suggestions</SlowLink>
        </Dropdown.Item>
        <Dropdown.Item asChild>
          <SlowLink href="/cats">Categories</SlowLink>
        </Dropdown.Item>
        <Dropdown.Item asChild>
          <SlowLink href="/accounts">Accounts</SlowLink>
        </Dropdown.Item>
        <Dropdown.Item asChild>
          <SlowLink href="/settings">Settings</SlowLink>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
