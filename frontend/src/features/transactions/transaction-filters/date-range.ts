export type DateRange =
  | "all-time"
  | "this-week"
  | "this-month"
  | "this-year"
  | "last-month"
  | "last-30-days"
  | "last-90-days"
  | "last-6-months"
  | "custom";

export const dateRanges: Array<{ value: DateRange; label: string }> = [
  { value: "all-time", label: "All time" },
  { value: "this-week", label: "This week" },
  { value: "this-month", label: "This month" },
  { value: "this-year", label: "This year" },
  { value: "last-month", label: "Last month" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "last-90-days", label: "Last 90 days" },
  { value: "last-6-months", label: "Last 6 months" },
  { value: "custom", label: "Custom" },
];

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function rangeDates(
  range: DateRange,
  customStart: string | null,
  customEnd: string | null,
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === "all-time") return { start: "", end: "" };
  if (range === "custom")
    return { start: customStart ?? "", end: customEnd ?? "" };
  const start = new Date(today);
  if (range === "this-week")
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (range === "this-month") start.setDate(1);
  if (range === "this-year") start.setMonth(0, 1);
  if (range === "last-month") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    const end = new Date(today);
    end.setDate(0);
    return { start: dateValue(start), end: dateValue(end) };
  }
  if (range === "last-30-days") start.setDate(today.getDate() - 29);
  if (range === "last-90-days") start.setDate(today.getDate() - 89);
  if (range === "last-6-months") {
    const day = today.getDate();
    start.setDate(1);
    start.setMonth(today.getMonth() - 6);
    start.setDate(
      Math.min(
        day,
        new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
      ),
    );
  }
  return { start: dateValue(start), end: dateValue(today) };
}

export function dateTimestamp(value: string, end = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (end) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
