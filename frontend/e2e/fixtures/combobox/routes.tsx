// Solid ports of the React cmdk test fixtures, from https://github.com/dip/cmdk
// (test/pages) via https://github.com/create-signal/cmdk-solid. Served only by
// vite.fixtures.config.ts for the Playwright suite — never part of the app bundle.
import { type RouteDefinition, useSearchParams } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";

import { Command } from "../../../src/ui/combobox/combobox";

function Index() {
  return (
    <div>
      <Command class="root">
        <Command.Input placeholder="Search…" class="input" />
        <Command.List class="list">
          <Command.Empty class="empty">No results.</Command.Empty>
          <Command.Item
            keywords={["key"]}
            onSelect={() => ((window as any).onSelect = "Item selected")}
            class="item"
          >
            Item
          </Command.Item>
          <Command.Item value="xxx" class="item">
            Value
          </Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}

function ItemPage() {
  const [unmount, setUnmount] = createSignal(false);
  const [mount, setMount] = createSignal(false);
  const [many, setMany] = createSignal(false);
  const [forceMount, setForceMount] = createSignal(false);

  return (
    <div>
      <button data-testid="mount" onClick={() => setMount(!mount())}>
        Toggle item B
      </button>
      <button data-testid="unmount" onClick={() => setUnmount(!unmount())}>
        Toggle item A
      </button>
      <button data-testid="many" onClick={() => setMany(!many())}>
        Toggle many items
      </button>
      <button
        data-testid="forceMount"
        onClick={() => setForceMount(!forceMount())}
      >
        Force mount item A
      </button>

      <Command>
        <Command.Input placeholder="Search…" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Show when={!unmount()}>
            <Command.Item forceMount={forceMount()}>A</Command.Item>
          </Show>
          <Show when={many()}>
            <Command.Item>1</Command.Item>
            <Command.Item>2</Command.Item>
            <Command.Item>3</Command.Item>
          </Show>
          <Show when={mount()}>
            <Command.Item>B</Command.Item>
          </Show>
        </Command.List>
      </Command>
    </div>
  );
}

function ItemAdvanced() {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <button data-testid="increment" onClick={() => setCount(count() + 1)}>
        Increment count
      </button>
      <Command>
        <Command.Input placeholder="Search…" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Item value={`Item A ${count()}`}>
            Item A {count()}
          </Command.Item>
          <Command.Item value={`Item B ${count()}`}>
            Item B {count()}
          </Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}

function GroupPage() {
  const [search, setSearch] = createSignal("");
  const [forceMount, setForceMount] = createSignal(false);
  return (
    <div>
      <button
        data-testid="forceMount"
        onClick={() => setForceMount(!forceMount())}
      >
        Force mount Group Letters
      </button>
      <Command>
        <Command.Input
          placeholder="Search…"
          value={search()}
          onValueChange={setSearch}
        />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Group heading="Animals">
            <Command.Item>Giraffe</Command.Item>
            <Command.Item>Chicken</Command.Item>
          </Command.Group>
          <Command.Group forceMount={forceMount()} heading="Letters">
            <Command.Item>A</Command.Item>
            <Command.Item>B</Command.Item>
            <Command.Item>Z</Command.Item>
          </Command.Group>
          <Show when={!!search()}>
            <Command.Group heading="Numbers">
              <Command.Item>One</Command.Item>
              <Command.Item>Two</Command.Item>
              <Command.Item>Three</Command.Item>
            </Command.Group>
          </Show>
        </Command.List>
      </Command>
    </div>
  );
}

function PropsPage() {
  const [params] = useSearchParams();
  const [value, setValue] = createSignal(
    (params.initialValue as string) ?? "ant",
  );
  const [search, setSearch] = createSignal("");
  const shouldFilter = params.shouldFilter !== "false";
  const customFilter = params.customFilter === "true";
  const filter = customFilter
    ? (item: string, search: string) => {
        if (!search || !item) return 1;
        return item.endsWith(search) ? 1 : 0;
      }
    : undefined;

  return (
    <div>
      <div data-testid="value">{value()}</div>
      <div data-testid="search">{search()}</div>
      <button
        data-testid="controlledValue"
        onClick={() => setValue("anteater")}
      >
        Change value
      </button>
      <button data-testid="controlledSearch" onClick={() => setSearch("eat")}>
        Change search value
      </button>
      <Command
        shouldFilter={shouldFilter}
        value={value()}
        onValueChange={setValue}
        filter={filter}
      >
        <Command.Input
          placeholder="Search…"
          value={search()}
          onValueChange={setSearch}
        />
        <Command.List>
          <Command.Item>ant</Command.Item>
          <Command.Item>anteater</Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}

function Keybinds() {
  const [params] = useSearchParams();
  return (
    <div>
      <Command vimBindings={!params.noVim}>
        <Command.Input />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Item value="disabled" disabled>
            Disabled
          </Command.Item>
          <Command.Item value="first">First</Command.Item>
          <Command.Group heading="Letters">
            <Command.Item>A</Command.Item>
            <Command.Item>B</Command.Item>
            <Command.Item>Z</Command.Item>
          </Command.Group>
          <Command.Group heading="Fruits">
            <Command.Item>Apple</Command.Item>
            <Command.Item>Banana</Command.Item>
            <Command.Item>Orange</Command.Item>
            <Command.Item disabled>Dragon Fruit</Command.Item>
            <Command.Item>Pear</Command.Item>
          </Command.Group>
          <Command.Item value="last">Last</Command.Item>
          <Command.Item value="disabled-3" disabled>
            Disabled 3
          </Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}

function Numeric() {
  return (
    <div>
      <Command class="root">
        <Command.Input placeholder="Search…" class="input" />
        <Command.List class="list">
          <Command.Empty class="empty">No results.</Command.Empty>
          <Command.Item value="removed" class="item">
            To be removed
          </Command.Item>
          <Command.Item value="foo.bar112.value" class="item">
            Not to be removed
          </Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}

function DialogPage() {
  const [open, setOpen] = createSignal(false);
  onMount(() => setOpen(true));
  return (
    <div>
      <Command.Dialog open={open()} onOpenChange={setOpen}>
        <Command.Input placeholder="Search…" />
        <Command.List>
          <Command.Empty>No results.</Command.Empty>
          <Command.Item onSelect={() => console.log("Item selected")}>
            Item
          </Command.Item>
          <Command.Item value="xxx">Value</Command.Item>
        </Command.List>
      </Command.Dialog>
    </div>
  );
}

export const comboboxRoutes: RouteDefinition[] = [
  { path: "/combobox", component: Index },
  { path: "/combobox/item", component: ItemPage },
  { path: "/combobox/item-advanced", component: ItemAdvanced },
  { path: "/combobox/group", component: GroupPage },
  { path: "/combobox/props", component: PropsPage },
  { path: "/combobox/keybinds", component: Keybinds },
  { path: "/combobox/numeric", component: Numeric },
  { path: "/combobox/dialog", component: DialogPage },
];
