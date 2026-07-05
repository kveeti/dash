import { For, Show } from "solid-js";

import type { Bucket } from "../../api/buckets";
import { Combobox, useCombobox } from "../../ui/combobox/combobox";
import { Command, useCommandState } from "../../ui/combobox/command";
import inputStyles from "../../ui/input/input.module.css";

interface Props {
  label: string;
  buckets: Bucket[];
  value: string | null;
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
  /** Shown on the trigger when nothing is selected. */
  placeholder: string;
  /** Shown in the search input inside the popover. */
  searchPlaceholder: string;
  error?: string;
  class?: string;
}

export function BucketCombobox(props: Props) {
  const selected = () => props.buckets.find((b) => b.id === props.value);
  return (
    <div class={`${inputStyles.field} ${props.class ?? ""}`}>
      <span class={inputStyles.labelRow}>
        <span class={inputStyles.label}>{props.label}</span>
        <Show when={props.error}>
          <span class={inputStyles.error}>{props.error}</span>
        </Show>
      </span>
      <Combobox>
        <Combobox.Trigger error={!!props.error}>
          <Show
            when={selected()}
            fallback={
              <span class={inputStyles.placeholder}>{props.placeholder}</span>
            }
          >
            {selected()!.name}
          </Show>
        </Combobox.Trigger>
        <Combobox.Content>
          <Command>
            <Command.Input style={{"border-bottom":"1px solid var(--gray-4)","margin-bottom": "0.25rem"}} placeholder={props.searchPlaceholder} />
            <Command.List hideScrollbar>
              <Rows
                buckets={props.buckets}
                onChange={props.onChange}
                onCreate={props.onCreate}
              />
            </Command.List>
          </Command>
        </Combobox.Content>
      </Combobox>
    </div>
  );
}

function Rows(props: {
  buckets: Bucket[];
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
}) {
  const { close } = useCombobox();
  const search = useCommandState((s) => s.search);
  const name = () => search().trim();

  return (
    <>
      <For each={props.buckets}>
        {(b) => (
          <Command.Item
            value={b.name}
            onSelect={() => {
              props.onChange(b.id);
              close();
            }}
          >
            {b.name}
          </Command.Item>
        )}
      </For>
      <Show when={name() !== ""}>
        <Command.Item
          forceMount
          value={`__create__${name()}`}
          onSelect={async () => {
            const created = await props.onCreate(name());
            props.onChange(created.id);
            close();
          }}
        >
          Create “{name()}”
        </Command.Item>
      </Show>
    </>
  );
}
