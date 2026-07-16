import { navigate, useLocationProperty } from "wouter/use-browser-location";

export function useSearchParam(name: string) {
  return useLocationProperty(
    () => new URLSearchParams(location.search).get(name),
    () => null,
  );
}

export function setSearchParams(
  values: Record<string, string | undefined>,
  opts?: { replace?: boolean },
) {
  const next = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) next.delete(name);
    else next.set(name, value);
  }
  navigate(`${location.pathname}${next.size ? `?${next}` : ""}`, opts);
}

export function setSearchParam(
  name: string,
  value: string | undefined,
  opts?: { replace?: boolean },
) {
  setSearchParams({ [name]: value }, opts);
}
