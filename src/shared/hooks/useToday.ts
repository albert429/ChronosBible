import { useSyncExternalStore } from "react";
import { today } from "../lib/format";

const listeners = new Set<() => void>();
let date = today();
let timer: ReturnType<typeof setInterval>;

function tick() {
  const next = today();
  if (next === date) return;
  date = next;
  listeners.forEach((listener) => listener());
}
function get() {
  if (!listeners.size) date = today();
  return date;
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

export function useToday() {
  return useSyncExternalStore(subscribe, get);
}
