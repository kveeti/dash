import { createContext } from "../../lib/create-context";

export const [useInboxUndo, InboxUndoContext] = createContext<{
  run: <T>(
    rowIds: string[],
    label: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
}>();
