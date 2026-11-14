import { useSyncExternalStore } from "react";
import { applyTheme, readStored, storedTheme, type Theme } from "./theme.ts";

export const FONT_MIN = 22;
export const FONT_MAX = 38;
const FONT_DEFAULT = 28;

type Snapshot = {
  font: number;
  theme: Theme;
  /** The theme in effect: `theme`, or the device's setting under auto. */
  dark: boolean;
  diacritics: boolean;
};

const listeners = new Set<() => void>();
let snapshot: Snapshot | undefined;
function saveStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Appearance is optional; progress storage failures are reported by App.
  }
}

function apply({ font, theme }: Snapshot) {
  const dark = applyTheme(theme);
  document.documentElement.style.setProperty("--verse-size", `${font}px`);
  return dark;
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
      dark: false,
      diacritics: readStored("word-diacritics", "true") !== "false",
    };
    snapshot.dark = apply(snapshot);
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
  next.dark = apply(next);
  snapshot = next;
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
