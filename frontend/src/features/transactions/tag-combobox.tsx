import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";

import { AnimatedHeight } from "../../ui/animated-height/animated-height";

import styles from "./tag-combobox.module.css";

type TagItem =
  | { type: "tag"; id: string; name: string; value: string }
  | { type: "create"; id: string; name: string; value: string };

export function TagCombobox(props: {
  tags: string[];
  onChange: (tag: string) => void;
  className?: string;
}) {
  const { contains } = Combobox.useFilter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const tag = input.trim().toLowerCase();

  const items: TagItem[] = [];
  const matching = tag
    ? props.tags.filter((value) => contains(value, tag))
    : props.tags;
  for (const value of matching) {
    items.push({ type: "tag", id: value, name: `#${value}`, value });
  }
  if (tag && !props.tags.includes(tag)) {
    items.push({
      type: "create",
      id: "create",
      name: `Create #${tag}`,
      value: tag,
    });
  }

  return (
    <div className={props.className}>
      <Combobox.Root<TagItem>
        items={items}
        value={null}
        open={open}
        inputValue={input}
        filter={null}
        autoHighlight
        itemToStringLabel={(item) => item.name}
        onInputValueChange={(nextValue, details) => {
          if (details.reason !== "item-press") setInput(nextValue);
        }}
        onValueChange={(item) => {
          if (item) props.onChange(item.value);
        }}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) setInput("");
        }}
      >
        <Combobox.Trigger className={styles.trigger}>
          <span className={styles.placeholder}>Tag…</span>
        </Combobox.Trigger>

        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={6}
            className={styles.positioner}
          >
            <Combobox.Popup className={styles.popup} aria-label="Add tag">
              <Combobox.Input
                className={styles.input}
                placeholder="Find or create tag"
                aria-label="Find or create tag"
              />

              <AnimatedHeight>
                <div className={styles.scroller}>
                  <Combobox.Empty>
                    <div className={styles.empty}>No tags</div>
                  </Combobox.Empty>

                  <Combobox.List className={styles.list}>
                    {(item: TagItem) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        className={styles.item}
                      >
                        <span>{item.name}</span>
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                </div>
              </AnimatedHeight>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
