import { Popover } from "@kobalte/core/popover";
import { createContext, createSignal, type JSX, useContext } from "solid-js";

import styles from "./combobox.module.css";
import inputStyles from "../input/input.module.css";

/** A trigger + popover shell around a cmdk <Command>. Selecting an item closes
 * it via useCombobox().close. Deliberately dumb: no device automation, no
 * nesting. A dialog/modal variant is a separate component when we need one —
 * never an automatic mobile/desktop switch. */
type ComboboxCtx = {
  close: () => void;
  onTriggerPointerDown: (e: PointerEvent) => void;
};
const ComboboxContext = createContext<ComboboxCtx>();
export const useCombobox = () => useContext(ComboboxContext)!;

function Root(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  // Kobalte's trigger toggles on click, not pointerdown, so re-pressing an open
  // trigger lingers until release. We toggle on pointerdown ourselves and swallow
  // the toggle Kobalte fires on the trailing click, so it doesn't undo us.
  let swallowNextChange = false;
  return (
    <ComboboxContext.Provider
      value={{
        close: () => setOpen(false),
        onTriggerPointerDown: (e) => {
          if (e.button !== 0 || e.pointerType !== "mouse") return;
          swallowNextChange = true;
          setOpen((o) => !o);
        },
      }}
    >
      <Popover
        open={open()}
        onOpenChange={(next) => {
          if (swallowNextChange) {
            swallowNextChange = false;
            return;
          }
          setOpen(next);
        }}
        placement="bottom-start"
        gutter={6}
      >
        {props.children}
      </Popover>
    </ComboboxContext.Provider>
  );
}

function Trigger(props: { children: JSX.Element; error?: boolean }) {
  const { onTriggerPointerDown } = useCombobox();
  return (
    <Popover.Trigger
      class={`${styles.trigger} ${inputStyles.control} ${props.error ? styles.triggerError : ""}`}
      onPointerDown={onTriggerPointerDown}
    >
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
