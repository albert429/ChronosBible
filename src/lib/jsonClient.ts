type Options<T> = {
  url: (key: string) => string;
  validate: (data: unknown, key: string) => data is T;
  message: (key: string, cause?: unknown) => string;
  /** Optional LRU bound for large, on-demand collections such as verse study. */
  maxEntries?: number;
  /** Optional transport decoder; validation still runs before data is cached. */
  parse?: (response: Response) => Promise<unknown>;
};

// Static public JSON only. A shared pending request survives component unmounts
// and React Strict Mode; failures are never cached, so a retry fetches again.
export function createJsonClient<T>(
  {
    url,
    validate,
    message,
    maxEntries = Infinity,
    parse = (response) => response.json(),
  }: Options<T>,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  const cache = new Map<string, T>();
  const pending = new Map<string, Promise<T>>();
  function load(key: string): Promise<T> {
    if (cache.has(key)) {
      const data = cache.get(key) as T;
      cache.delete(key);
      cache.set(key, data);
      return Promise.resolve(data);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const request = Promise.resolve()
      .then(async () => {
        const response = await fetcher(url(key), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data: unknown = await parse(response);
        if (!validate(data, key)) throw new Error("Invalid data");
        cache.set(key, data);
        while (cache.size > Math.max(0, maxEntries))
          cache.delete(cache.keys().next().value as string);
        return data;
      })
      .catch((cause) => {
        throw new Error(message(key, cause), { cause });
      })
      .finally(() => {
        clearTimeout(timeout);
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  }
  return {
    load,
    peek: (key: string) => cache.get(key),
    invalidate: (key: string) => {
      cache.delete(key);
    },
  };
}
