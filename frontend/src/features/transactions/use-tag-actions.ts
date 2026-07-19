import {
  useAddTransactionTagMutation,
  useRemoveTransactionTagMutation,
  useTagsQuery,
  type Transaction,
} from "../../api/transactions";
import { useLastSettledValue } from "../../lib/use-last-settled-value";
import type {
  TagActionItem,
  TagState,
  TransactionActionGroup,
  TransactionActionItem,
} from "./transaction-action-types";

export function useTagActions(props: {
  search: string;
  query: string;
  ids: string[];
  transactions: Transaction[];
  retainedTags: string[];
  onRetainTag: (tag: string) => void;
}) {
  const search = props.search.toLocaleLowerCase();
  const query = props.query.toLocaleLowerCase();
  const tagsQuery = useTagsQuery(query);
  const addTag = useAddTransactionTagMutation();
  const removeTag = useRemoveTransactionTagMutation();

  const serverTags = tagsQuery.data?.tags ?? [];
  const localTags = [
    ...new Set([
      ...props.transactions.flatMap((transaction) => transaction.tags),
      ...props.retainedTags,
    ]),
  ].filter((tag) => !search || tag.toLocaleLowerCase().includes(search));
  const tags = [...new Set([...serverTags, ...localTags])].sort();

  const tagState = (tag: string): TagState => {
    const tagged = props.transactions.filter((transaction) =>
      transaction.tags.includes(tag),
    ).length;
    if (tagged === 0) return "none";
    return tagged === props.transactions.length ? "all" : "some";
  };

  const settled =
    search === query &&
    !tagsQuery.isPlaceholderData &&
    !tagsQuery.isFetching &&
    !tagsQuery.isError;
  const currentTags = tags.map((tag) => ({ value: tag, create: false }));
  if (settled && search && !tags.includes(search)) {
    currentTags.push({ value: search, create: true });
  }
  const displayedTags = useLastSettledValue(currentTags, settled);
  const items: TransactionActionItem[] = displayedTags.map((tag) => ({
    type: "tag",
    id: `tag:${tag.value}`,
    name: tag.create ? `Create #${tag.value}` : `#${tag.value}`,
    value: tag.value,
    state: tagState(tag.value),
  }));
  const group: TransactionActionGroup | null = items.length
    ? { id: "tags", name: "Change or add tags…", items }
    : null;

  function toggle(item: TagActionItem) {
    props.onRetainTag(item.value);
    if (item.state === "all") {
      removeTag.mutate({ ids: props.ids, value: item.value });
    } else {
      addTag.mutate({ ids: props.ids, value: item.value });
    }
  }

  return {
    group,
    toggle,
    isFetching: tagsQuery.isFetching,
    isPending: tagsQuery.isPending,
    isError: tagsQuery.isError,
  };
}
