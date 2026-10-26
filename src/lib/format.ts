const numbers = new Intl.NumberFormat("ar-EG", { useGrouping: false });
const cairoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const labels = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
export const ar = (n: number) => numbers.format(n);
export const today = () => cairoDate.format(new Date());
export const dateLabel = (date: string) =>
  labels.format(new Date(date + "T12:00:00Z"));
/** A plain count of days: «يوم واحد»، «يومان»، «٣ أيام»، «١٢ يومًا». */
export function daysLabel(n: number) {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  const tens = n % 100;
  if (tens >= 3 && tens <= 10) return `${ar(n)} أيام`;
  return `${ar(n)} ${tens >= 11 ? "يومًا" : "يوم"}`;
}
/** Minutes and seconds (or hours too) in Eastern Arabic digits: «٣:٠٥». */
export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const pad = (n: number) => ar(n).padStart(2, ar(0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return hours
    ? `${ar(hours)}:${pad(minutes)}:${pad(total % 60)}`
    : `${ar(minutes)}:${pad(total % 60)}`;
}
