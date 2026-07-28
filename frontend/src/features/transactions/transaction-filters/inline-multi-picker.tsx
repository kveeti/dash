import { Combobox } from "@base-ui/react/combobox";

import { Checkbox } from "../../../ui/checkbox/checkbox";
import { Input } from "../../../ui/input/input";
import { useComboboxOptionKeyboard } from "../use-combobox-option-keyboard";

export type FilterItem = { id: string; name: string };

export function InlineMultiPicker(props: {
  label: string;
  inputLabel: string;
  emptyText: string;
  items: FilterItem[];
  selectedItems: FilterItem[];
  values: string[];
  search: string;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  onChange: (values: string[]) => void;
  onSearchChange: (search: string) => void;
}) {
  const keyboard = useComboboxOptionKeyboard({
    items: props.items,
    onSpace: (item) =>
      props.onChange(
        props.values.includes(item.id)
          ? props.values.filter((value) => value !== item.id)
          : [...props.values, item.id],
      ),
  });

  return (
    <Combobox.Root<FilterItem, true>
      items={props.items}
      value={props.selectedItems}
      multiple
      inline
      open
      inputValue={props.search}
      autoHighlight
      filter={null}
      itemToStringLabel={(item) => item.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      onInputValueChange={(value, details) => {
        if (details.reason === "item-press") return;
        keyboard.reset();
        props.onSearchChange(value);
      }}
      onItemHighlighted={keyboard.onItemHighlighted}
      onValueChange={(value) => props.onChange(value.map((item) => item.id))}
    >
      <div className="text-sm" aria-busy={props.isFetching || undefined}>
        <Combobox.Input
          render={<Input className="text-sm" />}
          placeholder={props.inputLabel}
          aria-label={props.inputLabel}
          onKeyDown={keyboard.onInputKeyDown}
          autoFocus
        />
        <div className="-mx-1 mt-2">
          <Combobox.Status>
            {props.isPending ? (
              <div className="flex min-h-8 items-center px-3 text-gray-600">
                Loading…
              </div>
            ) : props.isError ? (
              <div className="flex min-h-8 items-center px-3 text-gray-600">
                Error loading options
              </div>
            ) : null}
          </Combobox.Status>
          <Combobox.Empty>
            {!props.isPending && !props.isError ? (
              <div className="p-4 text-center text-gray-600">
                {props.emptyText}
              </div>
            ) : null}
          </Combobox.Empty>
          <Combobox.List
            className="outline-none"
            aria-label={`Choose ${props.label}`}
          >
            {(item) => (
              <Combobox.Item
                key={item.id}
                value={item}
                className="flex min-h-8 cursor-default items-center gap-2 rounded-lg px-3 text-gray-900 outline-none select-none data-highlighted:bg-popover-item-selected"
              >
                <Checkbox
                  className="pointer-events-none"
                  checked={props.values.includes(item.id)}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <span>{item.name}</span>
              </Combobox.Item>
            )}
          </Combobox.List>
        </div>
      </div>
    </Combobox.Root>
  );
}
