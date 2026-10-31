import { useEffect, useState } from "react";

type Client<T> = {
  load(key: string): Promise<T>;
  peek(key: string): T | undefined;
};

/** Load one keyed resource, ignoring responses for a key that is no longer current. */
export function useResource<T>(client: Client<T>, key: string, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({
    key,
  });
  const cached = client.peek(key);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setResult({ key });
    client.load(key).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (error: Error) => {
        if (active) setResult({ key, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [client, key, attempt, enabled]);
  return {
    data: enabled
      ? cached || (result.key === key ? result.data : undefined)
      : undefined,
    error: enabled && result.key === key ? result.error : undefined,
    retry: () => {
      setResult({ key });
      setAttempt((n) => n + 1);
    },
  };
}
