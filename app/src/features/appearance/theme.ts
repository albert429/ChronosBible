/** «تلقائي» follows the device's light or dark setting. */
export type Theme = "auto" | "light" | "dark";

export function readStored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

/** Legacy "true" was a choice; "false" was the default and now means auto. */
export function storedTheme(): Theme {
  const theme = readStored("word-theme", "");
  if (theme === "auto" || theme === "light" || theme === "dark") return theme;
  return readStored("word-dark", "false") === "true" ? "dark" : "auto";
}

/** Shared by the synchronous head script and runtime appearance settings. */
export function applyTheme(theme = storedTheme()) {
  const dark =
    theme === "dark" ||
    (theme === "auto" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#181e1a" : "#f7f5ef");
  return dark;
}
