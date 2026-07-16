import { Combobox } from "@base-ui/react/combobox";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

import styles from "./nav.module.css";

const pages = [
  { label: "inbox", href: "/inbox" },
  { label: "transactions", href: "/transactions" },
  { label: "stats", href: "/stats" },
  { label: "import", href: "/imports" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <nav>
      <div>
        <ul className={styles.navLinks}>
          {pages.map((page) => (
            <li key={page.href} className={styles.link}>
              <Link href={page.href}>{page.label}</Link>
            </li>
          ))}
        </ul>
      </div>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </nav>
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
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.palette}>
          <Dialog.Title className={styles.srOnly}>Go to page</Dialog.Title>

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
              className={styles.input}
              placeholder="Search…"
              aria-label="Search pages"
            />
            <Combobox.Empty>
              <p className={styles.empty}>No results.</p>
            </Combobox.Empty>
            <Combobox.List className={styles.list}>
              {(page: (typeof pages)[number]) => (
                <Combobox.Item
                  key={page.href}
                  value={page}
                  className={styles.item}
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
