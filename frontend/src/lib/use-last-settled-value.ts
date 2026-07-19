import { useRef } from "react";

export function useLastSettledValue<T>(value: T, settled: boolean) {
  const settledValue = useRef(value);
  if (settled) settledValue.current = value;
  return settled ? value : settledValue.current;
}
