import { createContext } from "../../lib/create-context";

export const [useSplitInbox, SplitInboxContext] = createContext<{
  open: (rowId: string) => void;
  close: () => void;
}>();
