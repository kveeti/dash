import { useNavigate } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount } from "solid-js";

import { Command } from "../../ui/combobox/combobox";

import styles from "./nav.module.css";

const pages = [
  { label: "inbox", href: "/inbox" },
  { label: "transactions", href: "/transactions" },
];

export function Nav() {
  const [isOpen, setIsOpen] = createSignal(false);
  const navigate = useNavigate();

  const go = (href: string) => {
    setIsOpen(false);
    navigate(href);
  };

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  return (
    <nav>
      <div>
        <ul class={styles.navLinks}>
          <For each={pages}>
            {(page) => (
              <li class={styles.link}>
                <a href={page.href}>{page.label}</a>
              </li>
            )}
          </For>
        </ul>
      </div>

      <Command.Dialog open={isOpen()} onOpenChange={setIsOpen} loop>
        <Command.Input placeholder="Search…" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Group heading="Pages">
            <For each={pages}>
              {(page) => (
                <Command.Item onSelect={() => go(page.href)}>
                  {page.label}
                </Command.Item>
              )}
            </For>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </nav>
  );
}
