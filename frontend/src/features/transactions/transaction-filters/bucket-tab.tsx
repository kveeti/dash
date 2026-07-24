import { useState } from "react";

import { useBucketSearchQuery, type BucketKind } from "../../../api/buckets";
import { setSearchParams, useSearchParams } from "../../../lib/search-param";
import { useDebouncedValue } from "../../../lib/use-debounced-value";
import { InlineMultiPicker } from "./inline-multi-picker";

export function BucketTab(props: {
  label: string;
  kinds: BucketKind[];
  param: "category" | "account";
}) {
  const values = useSearchParams(props.param);
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 50);
  const buckets = useBucketSearchQuery(query, props.kinds);
  const selectedItems = values.map((id) => {
    const bucket = buckets.data?.find((item) => item.id === id);
    return { id, name: bucket?.name ?? id };
  });
  const items = (buckets.data ?? [])
    .filter((bucket) => !bucket.hidden && props.kinds.includes(bucket.kind))
    .map((bucket) => ({ id: bucket.id, name: bucket.name }));

  return (
    <section aria-label={`${props.label} filter`} className="space-y-3">
      <h2 className="font-medium">{props.label}</h2>
      <InlineMultiPicker
        label={props.label}
        inputLabel={`Filter ${props.label.toLocaleLowerCase()}`}
        emptyText="No matches"
        items={items}
        selectedItems={selectedItems}
        values={values}
        search={search}
        isPending={buckets.isPending}
        isFetching={buckets.isFetching}
        isError={buckets.isError}
        onSearchChange={setSearch}
        onChange={(next) =>
          setSearchParams(
            { [props.param]: next.length ? next : undefined },
            { replace: true },
          )
        }
      />
    </section>
  );
}
