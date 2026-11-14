import { useSyncExternalStore } from "react";

export const FONT_MIN = 22;
export const FONT_MAX = 38;
const FONT_DEFAULT = 28;

/** «تلقائي» follows the device's light or dark setting. */
export type Theme = "auto" | "light" | "dark";
type Snapshot = {
  font: number;
  theme: Theme;
  /** The theme in effect: `theme`, or the device's setting under auto. */
  dark: boolean;
  diacritics: boolean;
};

const listeners = new Set<() => void>();
let snapshot: Snapshot | undefined;
const systemDark = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-color-scheme: dark)").matches;

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

/**
 * `word-theme` holds the choice. Before it existed only `word-dark` did, and
 * it was written for everyone: "true" was always a choice, "false" usually
 * just the old default, so it now means auto. index.html reads the same keys.
 */
function storedTheme(): Theme {
  const theme = readStored("word-theme", "");
  if (theme === "auto" || theme === "light" || theme === "dark") return theme;
  return readStored("word-dark", "false") === "true" ? "dark" : "auto";
}

function apply({ font, dark }: Snapshot) {
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--verse-size", `${font}px`);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#181e1a" : "#f7f5ef");
}
function get() {
  if (!snapshot) {
    const theme = storedTheme();
    snapshot = {
      font: Math.max(
        FONT_MIN,
        Math.min(
          FONT_MAX,
          Number(readStored("word-font", String(FONT_DEFAULT))) || FONT_DEFAULT,
        ),
      ),
      theme,
      dark: theme === "auto" ? systemDark() : theme === "dark",
      diacritics: readStored("word-diacritics", "true") !== "false",
    };
    apply(snapshot);
    if (typeof matchMedia === "function")
      matchMedia("(prefers-color-scheme: dark)").addEventListener(
        "change",
        () => {
          if (snapshot?.theme === "auto") update({});
        },
      );
  }
  return snapshot;
}
function update(patch: Partial<Omit<Snapshot, "dark">>) {
  const next = { ...get(), ...patch };
  next.dark = next.theme === "auto" ? systemDark() : next.theme === "dark";
  snapshot = next;
  apply(next);
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const actions = {
  setFont: (font: number) => {
    saveStored("word-font", String(font));
    update({ font });
  },
  setTheme: (theme: Theme) => {
    saveStored("word-theme", theme);
    update({ theme });
  },
  setDiacritics: (diacritics: boolean) => {
    saveStored("word-diacritics", String(diacritics));
    update({ diacritics });
  },
};

/** Applies the saved preferences before the first render. */
export const initAppearance = get;

export function useAppearance() {
  return { ...useSyncExternalStore(subscribe, get), ...actions };
}

/** Only whether vowel marks show: text-size and theme changes skip renders. */
export function useDiacritics() {
  return useSyncExternalStore(subscribe, () => get().diacritics);
}
