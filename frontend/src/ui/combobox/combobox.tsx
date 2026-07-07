import { Popover } from "@kobalte/core/popover";
import { createContext, createSignal, type JSX, useContext } from "solid-js";

import styles from "./combobox.module.css";

/** A trigger + popover shell around a cmdk <Command>. Selecting an item closes
 * it via useCombobox().close. Deliberately dumb: no device automation, no
 * nesting. A dialog/modal variant is a separate component when we need one —
 * never an automatic mobile/desktop switch. */
type ComboboxCtx = {
  close: () => void;
};
const ComboboxContext = createContext<ComboboxCtx>();
export const useCombobox = () => useContext(ComboboxContext)!;

function Root(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return (
    <ComboboxContext.Provider value={{ close: () => setOpen(false) }}>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="bottom-start"
        gutter={6}
      >
        {props.children}
      </Popover>
    </ComboboxContext.Provider>
  );
}

function Trigger(props: { children: JSX.Element; class?: string }) {
  return (
    <Popover.Trigger class={`${styles.trigger} ${props.class ?? ""}`}>
      {props.children}
    </Popover.Trigger>
  );
}

function Content(props: { children: JSX.Element }) {
  return (
    <Popover.Portal>
      <Popover.Content class={styles.content}>{props.children}</Popover.Content>
    </Popover.Portal>
  );
}

export const Combobox = Object.assign(Root, { Trigger, Content });
