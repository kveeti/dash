import { TagIcon } from "@heroicons/react/24/outline";

import { BucketTab } from "./bucket-tab";
import { TabPanel, TabTrigger } from "./filter-button";

export function Trigger(props: { applied: boolean }) {
  return (
    <TabTrigger
      value="category"
      label="Category"
      Icon={TagIcon}
      applied={props.applied}
    />
  );
}

export function Panel() {
  return (
    <TabPanel value="category">
      <BucketTab
        label="Categories"
        kinds={["expense", "income", "person"]}
        param="category"
      />
    </TabPanel>
  );
}
