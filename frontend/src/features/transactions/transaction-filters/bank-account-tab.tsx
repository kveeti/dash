import { WalletIcon } from "@heroicons/react/24/outline";

import { BucketTab } from "./bucket-tab";
import { TabPanel, TabTrigger } from "./filter-button";

export function Trigger(props: { applied: boolean }) {
  return (
    <TabTrigger
      value="account"
      label="Account"
      Icon={WalletIcon}
      applied={props.applied}
    />
  );
}

export function Panel() {
  return (
    <TabPanel value="account">
      <BucketTab
        label="Accounts"
        kinds={["asset", "liability"]}
        param="account"
      />
    </TabPanel>
  );
}
