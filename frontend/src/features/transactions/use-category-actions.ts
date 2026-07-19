import {
  useBucketSearchQuery,
  useCreateBucketMutation,
  type BucketKind,
} from "../../api/buckets";
import { useBulkCategorizeMutation } from "../../api/transactions";
import { useLastSettledValue } from "../../lib/use-last-settled-value";
import type {
  CategoryActionItem,
  TransactionActionGroup,
  TransactionActionItem,
} from "./transaction-action-types";

const categoryKinds: BucketKind[] = ["expense", "income", "person"];

export function useCategoryActions(props: {
  search: string;
  query: string;
  ids: string[];
  selectedCount: number;
  onFinish: () => void;
}) {
  const bucketsQuery = useBucketSearchQuery(props.query, categoryKinds);
  const createBucket = useCreateBucketMutation();
  const categorize = useBulkCategorizeMutation();

  const settled =
    props.search === props.query &&
    !bucketsQuery.isPlaceholderData &&
    !bucketsQuery.isFetching &&
    !bucketsQuery.isError;
  const items: TransactionActionItem[] =
    bucketsQuery.data?.map((bucket) => ({
      type: "bucket" as const,
      id: `bucket:${bucket.id}`,
      name: bucket.name,
      bucket,
    })) ?? [];
  if (settled && props.search && bucketsQuery.data) {
    const exactMatch = bucketsQuery.data.some(
      (bucket) =>
        bucket.name.trim().toLocaleLowerCase() ===
        props.search.toLocaleLowerCase(),
    );
    if (!exactMatch) {
      items.push({
        type: "create-bucket",
        id: "create-bucket",
        name: `Create expense “${props.search}”`,
        bucketName: props.search,
      });
    }
  }

  const currentGroup: TransactionActionGroup | null = items.length
    ? {
        id: "categories",
        name: props.selectedCount > 1 ? "Categorize all as…" : "Categorize as…",
        items,
      }
    : null;
  const group = useLastSettledValue(currentGroup, settled);

  async function select(item: CategoryActionItem) {
    if (categorize.isPending || createBucket.isPending) return;
    const bucket =
      item.type === "bucket"
        ? item.bucket
        : await createBucket.mutateAsync({
            kind: "expense",
            name: item.bucketName,
          });
    categorize.mutate(
      { ids: props.ids, bucket },
      { onSuccess: props.onFinish },
    );
  }

  return {
    group,
    select,
    isFetching: bucketsQuery.isFetching,
    isPending: bucketsQuery.isPending,
    isError: bucketsQuery.isError,
  };
}
