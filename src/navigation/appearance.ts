import { useSyncExternalStore } from "react";

export const FONT_MIN = 22;
export const FONT_MAX = 38;
const FONT_DEFAULT = 28;

type Snapshot = { font: number; dark: boolean; diacritics: boolean };

const listeners = new Set<() => void>();
let snapshot: Snapshot | undefined;

function readStored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Appearance is optional; progress storage failures are reported by App.
  }
}

/** Preserve the existing preference keys when changing the reading layout. */
function apply({ font, dark, diacritics }: Snapshot) {
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--verse-size", `${font}px`);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#181e1a" : "#f7f5ef");
  saveStored("word-dark", String(dark));
  saveStored("word-font", String(font));
  saveStored("word-diacritics", String(diacritics));
}
function get() {
  if (!snapshot) {
    snapshot = {
      font: Math.max(
        FONT_MIN,
        Math.min(
          FONT_MAX,
          Number(readStored("word-font", String(FONT_DEFAULT))) || FONT_DEFAULT,
        ),
      ),
      dark: readStored("word-dark", "false") === "true",
      diacritics: readStored("word-diacritics", "true") !== "false",
    };
    apply(snapshot);
  }
  return snapshot;
}
function update(patch: Partial<Snapshot>) {
  snapshot = { ...get(), ...patch };
  apply(snapshot);
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const actions = {
  setFont: (font: number) => update({ font }),
  setDark: (dark: boolean) => update({ dark }),
  setDiacritics: (diacritics: boolean) => update({ diacritics }),
};

/** Applies the saved preferences before the first render. */
export const initAppearance = get;

export function useAppearance() {
  return { ...useSyncExternalStore(subscribe, get), ...actions };
}
