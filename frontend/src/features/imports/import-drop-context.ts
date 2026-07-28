import { createContext } from "../../lib/create-context";

export type ImportDropValue = {
  file: File | null;
  clearFile: () => void;
};

export const [useImportDrop, ImportDropContext] =
  createContext<ImportDropValue>();
