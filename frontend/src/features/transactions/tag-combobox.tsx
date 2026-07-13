import { For, Show } from "solid-js";

import { Combobox, useCombobox } from "../../ui/combobox/combobox";
import { Command, useCommandState } from "../../ui/combobox/command";

import inputStyles from "../../ui/input/input.module.css";

export function TagCombobox(props: {
  tags: string[];
  onChange: (tag: string) => void;
  class?: string;
}) {
  return (
    <div class={props.class}>
      <Combobox>
        <Combobox.Trigger class={inputStyles.control}>
          <span class={inputStyles.placeholder}>Tag…</span>
        </Combobox.Trigger>
        <Combobox.Content>
          <Command>
            <Command.Input
              placeholder="Find or create tag"
              style={{
                "border-bottom": "var(--border-popover)",
                "margin-bottom": "0.25rem",
              }}
            />
            <Command.List hideScrollbar>
              <TagRows tags={props.tags} onChange={props.onChange} />
            </Command.List>
          </Command>
        </Combobox.Content>
      </Combobox>
    </div>
  );
}

function TagRows(props: { tags: string[]; onChange: (tag: string) => void }) {
  const combobox = useCombobox();
  const search = useCommandState((state) => state.search);
  const tag = () => search().trim().toLowerCase();
  const choose = (value: string) => {
    props.onChange(value);
    combobox?.close();
  };

  return (
    <>
      <For each={props.tags}>
        {(value) => (
          <Command.Item value={value} onSelect={() => choose(value)}>
            #{value}
          </Command.Item>
        )}
      </For>
      <Show when={tag() && !props.tags.includes(tag())}>
        <Command.Group value="create" forceMount>
          <Command.Item forceMount onSelect={() => choose(tag())}>
            Create #{tag()}
          </Command.Item>
        </Command.Group>
      </Show>
    </>
  );
}
