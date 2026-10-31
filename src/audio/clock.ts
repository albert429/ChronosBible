import { ar } from "../lib/format.ts";

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
