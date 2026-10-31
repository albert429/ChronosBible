import { ar } from "./format.ts";

/** A plain count of days: «يوم واحد»، «يومان»، «٣ أيام»، «١٢ يومًا». */
export function daysLabel(n: number) {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  const tens = n % 100;
  if (tens >= 3 && tens <= 10) return `${ar(n)} أيام`;
  return `${ar(n)} ${tens >= 11 ? "يومًا" : "يوم"}`;
}
