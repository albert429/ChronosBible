const numbers = new Intl.NumberFormat("ar-EG", { useGrouping: false });
const labels = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
export const ar = (n: number) => numbers.format(n);
export const dateLabel = (date: string) =>
  labels.format(new Date(date + "T12:00:00Z"));
