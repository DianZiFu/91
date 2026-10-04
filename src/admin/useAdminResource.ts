import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AdminResource } from "./AdminResource";

type ResourceOptions<T> = {
  queryKey?: string;
  active: boolean;
  intervalMs: number | null | ((data: T) => number | null);
  retryOnError?: boolean;
  maxRetries?: number;
  initialData: T;
  onUnauthorized?: () => void;
};

export function useAdminResource<T>(load: (signal: AbortSignal) => Promise<T>, options: ResourceOptions<T>) {
  const identity = options.queryKey ?? load;
  const resource = useMemo(() => new AdminResource(load, options.initialData), [identity]);
  resource.load = load;
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  const interval = typeof options.intervalMs === "function" ? options.intervalMs(state.data) : options.intervalMs;

  useEffect(() => { resource.setInterval(interval); }, [resource, interval]);
  useEffect(() => { resource.setRetryOnError(options.retryOnError ?? true, options.maxRetries); }, [resource, options.retryOnError, options.maxRetries]);
  useEffect(() => {
    if (!options.active) return;
    const resume = () => { if (document.hidden) resource.pause(); else resource.resume(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    resume();
    return () => {
      resource.pause();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    };
  }, [resource, options.active]);
  useEffect(() => {
    if (state.unauthorized) options.onUnauthorized?.();
  }, [state.unauthorized, options.onUnauthorized]);

  return { ...state, refresh: resource.refresh, invalidate: resource.invalidate, setData: resource.setData };
}
