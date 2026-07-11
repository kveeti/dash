import { For, Show } from "solid-js";

import type { Bucket } from "../../api/buckets";
import { Combobox, useCombobox } from "../../ui/combobox/combobox";
import { Command, useCommandState } from "../../ui/combobox/command";
import { Field } from "../../ui/input/input";

import inputStyles from "../../ui/input/input.module.css";

interface Props {
  label: string;
  buckets: Bucket[];
  value: string | null;
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
  onCreatePerson?: (name: string) => Promise<Bucket>;
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
    <Field label={props.label} error={props.error} class={props.class} as="div">
      <Combobox>
        <Combobox.Trigger
          class={`${inputStyles.control} ${props.error ? inputStyles.invalid : ""}`}
        >
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
          <CategoryMenu
            buckets={props.buckets}
            onChange={props.onChange}
            onCreate={props.onCreate}
            onCreatePerson={props.onCreatePerson}
            searchPlaceholder={props.searchPlaceholder}
          />
        </Combobox.Content>
      </Combobox>
    </Field>
  );
}

/** The popover menu (search + bucket list + create) minus any trigger, so a
 * caller can anchor it to its own trigger — e.g. a whole inbox row. */
export function CategoryMenu(props: {
  buckets: Bucket[];
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
  onCreatePerson?: (name: string) => Promise<Bucket>;
  searchPlaceholder: string;
}) {
  return (
    <Command>
      <Command.Input
        style={{
          "border-bottom": "var(--border-popover)",
          "margin-bottom": "0.25rem",
        }}
        placeholder={props.searchPlaceholder}
      />
      <Command.List hideScrollbar>
        <Rows
          buckets={props.buckets}
          onChange={props.onChange}
          onCreate={props.onCreate}
          onCreatePerson={props.onCreatePerson}
        />
      </Command.List>
    </Command>
  );
}

function Rows(props: {
  buckets: Bucket[];
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<Bucket>;
  onCreatePerson?: (name: string) => Promise<Bucket>;
}) {
  const { close } = useCombobox();
  const search = useCommandState((s) => s.search);
  const name = () => search().trim();

  return (
    <>
      <For each={props.buckets}>
        {(b) => (
          <Command.Item
            value={`${b.kind}:${b.name}`}
            keywords={[b.name]}
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
        <Command.Group value="create" forceMount>
          <Command.Item
            forceMount
            onSelect={async () => {
              const created = await props.onCreate(name());
              props.onChange(created.id);
              close();
            }}
          >
            Create category “{name()}”
          </Command.Item>
          <Show when={props.onCreatePerson}>
            <Command.Item
              forceMount
              onSelect={async () => {
                const created = await props.onCreatePerson!(name());
                props.onChange(created.id);
                close();
              }}
            >
              Create person “{name()}”
            </Command.Item>
          </Show>
        </Command.Group>
      </Show>
    </>
  );
}
