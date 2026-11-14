/** Public CDN origin, or "/" for a same-origin media route. Never credentials. */
export function audioUrl(path: string, base = "") {
  if (!base || base === "/") return path;
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Audio host must be an HTTPS origin without credentials or a path.",
    );
  return new URL(path, url.origin).href;
}
