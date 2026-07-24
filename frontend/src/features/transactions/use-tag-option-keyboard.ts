import type {
  TagActionItem,
  TransactionActionGroup,
} from "./transaction-action-types";
import { useComboboxOptionKeyboard } from "./use-combobox-option-keyboard";

export function useTagOptionKeyboard(props: {
  groups: TransactionActionGroup[];
  onToggleTag: (item: TagActionItem) => void;
}) {
  return useComboboxOptionKeyboard({
    items: props.groups.flatMap((group) => group.items),
    canSelectWithSpace: (item) => item.type === "tag",
    onSpace: (item) => {
      if (item.type === "tag") props.onToggleTag(item);
    },
  });
}
