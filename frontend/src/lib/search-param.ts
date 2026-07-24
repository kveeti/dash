import {
  navigate,
  useLocationProperty,
  useSearch,
} from "wouter/use-browser-location";

export function useSearchParam(name: string) {
  return useLocationProperty(
    () => new URLSearchParams(location.search).get(name),
    () => null,
  );
}

export function useSearchParams(name: string) {
  return new URLSearchParams(useSearch()).getAll(name);
}

export function setSearchParams(
  values: Record<string, string | string[] | undefined>,
  opts?: { replace?: boolean },
) {
  const next = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(values)) {
    next.delete(name);
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      next.append(name, item);
    }
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
