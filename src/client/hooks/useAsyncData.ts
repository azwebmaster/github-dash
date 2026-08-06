import { useEffect, useRef, useState } from 'react';

export type PollIntervalOption<T> = number | null | undefined | ((data: T) => number | null | undefined);

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options?: {
    /** Keep refetching while this returns a positive interval (ms). */
    pollInterval?: PollIntervalOption<T>;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const pollIntervalRef = useRef(options?.pollInterval);
  pollIntervalRef.current = options?.pollInterval;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedulePoll = (result: T) => {
      const option = pollIntervalRef.current;
      const interval = typeof option === 'function' ? option(result) : option;
      if (interval && interval > 0) {
        timeoutId = setTimeout(() => {
          void run(false);
        }, interval);
      }
    };

    const run = (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }
      loaderRef
        .current()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
          schedulePoll(result);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          if (isInitial) setData(null);
        })
        .finally(() => {
          if (!cancelled && isInitial) setLoading(false);
        });
    };

    run(true);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}
