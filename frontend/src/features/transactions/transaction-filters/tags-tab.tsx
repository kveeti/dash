import { HashtagIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import { useTagsQuery } from "../../../api/transactions";
import { setSearchParams, useSearchParams } from "../../../lib/search-param";
import { useDebouncedValue } from "../../../lib/use-debounced-value";
import { TabPanel, TabTrigger } from "./filter-button";
import { InlineMultiPicker } from "./inline-multi-picker";

export function Trigger(props: { applied: boolean }) {
  return (
    <TabTrigger
      value="tags"
      label="Tags"
      Icon={HashtagIcon}
      applied={props.applied}
    />
  );
}

export function Panel() {
  const values = useSearchParams("tag");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 50);
  const tags = useTagsQuery(query);
  const items = (tags.data?.tags ?? []).map((tag) => ({
    id: tag,
    name: `#${tag}`,
  }));
  const selectedItems = values.map((tag) => ({ id: tag, name: `#${tag}` }));

  return (
    <TabPanel value="tags">
      <section aria-label="Tags filter" className="space-y-3">
        <h2 className="font-medium">Tags</h2>
        <InlineMultiPicker
          label="Tags"
          inputLabel="Filter tags"
          emptyText="No tags"
          items={items}
          selectedItems={selectedItems}
          values={values}
          search={search}
          isPending={tags.isPending}
          isFetching={tags.isFetching}
          isError={tags.isError}
          onSearchChange={setSearch}
          onChange={(next) =>
            setSearchParams(
              { tag: next.length ? next : undefined },
              { replace: true },
            )
          }
        />
      </section>
    </TabPanel>
  );
}
