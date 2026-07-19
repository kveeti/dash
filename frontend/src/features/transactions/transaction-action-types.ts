import type { Bucket } from "../../api/buckets";

export type TagState = "all" | "some" | "none";

export type TransactionActionItem =
  | { type: "bucket"; id: string; name: string; bucket: Bucket }
  | {
      type: "create-bucket";
      id: "create-bucket";
      name: string;
      bucketName: string;
    }
  | {
      type: "tag";
      id: string;
      name: string;
      value: string;
      state: TagState;
    }
  | { type: "remove"; id: "remove"; name: string };

export type TransactionActionGroup = {
  id: string;
  name: string | null;
  items: TransactionActionItem[];
};

export type CategoryActionItem = Extract<
  TransactionActionItem,
  { type: "bucket" | "create-bucket" }
>;

export type TagActionItem = Extract<TransactionActionItem, { type: "tag" }>;
