import { createContext, useContext } from "react";

export const FieldInvalidContext = createContext(false);

export function useFieldInvalid() {
  return useContext(FieldInvalidContext);
}
