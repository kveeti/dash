import type { Bucket } from "../../api/buckets";

export type CategoryValue = {
  id: string;
  name: string;
  current: number;
  comparison: number;
  children: CategoryValue[];
  direct?: CategoryValue;
};

export function categoryGroups(
  buckets: Bucket[],
  values: Map<string, { current: number; comparison: number }>,
  kind: "expense" | "income",
): CategoryValue[] {
  const categories = buckets.filter((bucket) => bucket.kind === kind);
  const byID = new Map(categories.map((bucket) => [bucket.id, bucket]));
  const children = new Map<string, Bucket[]>();
  for (const bucket of categories) {
    if (bucket.parent_id && byID.has(bucket.parent_id)) {
      const list = children.get(bucket.parent_id) ?? [];
      list.push(bucket);
      children.set(bucket.parent_id, list);
    }
  }

  const out: CategoryValue[] = [];
  for (const bucket of categories) {
    if (bucket.parent_id && byID.has(bucket.parent_id)) continue;
    const own = values.get(bucket.id);
    const childValues = (children.get(bucket.id) ?? [])
      .filter((child) => values.has(child.id))
      .map((child) => ({
        id: child.id,
        name: child.name,
        current: values.get(child.id)!.current,
        comparison: values.get(child.id)!.comparison,
        children: [],
      }))
      .sort((a, b) => b.current - a.current || b.comparison - a.comparison);
    if (!own && childValues.length === 0) continue;

    const direct =
      own && childValues.length > 0
        ? {
            id: bucket.id,
            name: "Other",
            current: own.current,
            comparison: own.comparison,
            children: [],
          }
        : undefined;
    out.push({
      id: bucket.id,
      name: bucket.name,
      current: childValues.reduce(
        (sum, child) => sum + child.current,
        own?.current ?? 0,
      ),
      comparison: childValues.reduce(
        (sum, child) => sum + child.comparison,
        own?.comparison ?? 0,
      ),
      children: childValues,
      direct,
    });
  }
  return out.sort(
    (a, b) => b.current - a.current || b.comparison - a.comparison,
  );
}
