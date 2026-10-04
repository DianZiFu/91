import type { SetStateAction } from "react";
import { APIResponseError, UnauthorizedError } from "./api";
import { RefreshRequest } from "./RefreshRequest";

export type AdminResourceState<T> = {
  data: T;
  ready: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  failure: Error | null;
  unauthorized: boolean;
};

function retryable(error: Error | null) {
  if (!error || error instanceof UnauthorizedError) return false;
  return !(error instanceof APIResponseError) || error.status >= 500 || error.status === 408 || error.status === 429;
}

// Each instance owns one query, including its responses and retry schedule.
export class AdminResource<T> {
  private state: AdminResourceState<T>;
  private listeners = new Set<() => void>();
  private request: RefreshRequest<T>;
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private generation = 0;
  private reading = false;
  private failures = 0;
  private interval: number | null = null;
  private retryOnError = true;
  private maxRetries = Infinity;

  constructor(public load: (signal: AbortSignal) => Promise<T>, initialData: T) {
    this.state = { data: initialData, ready: false, loading: true, refreshing: false, error: "", failure: null, unauthorized: false };
    this.request = new RefreshRequest((signal) => this.load(signal),
      (data) => {
        this.failures = 0;
        this.update({ data, ready: true, loading: false, error: "", failure: null });
      },
      (error) => {
        const failure = error instanceof Error ? error : new Error("数据加载失败");
        this.failures++;
        const unauthorized = failure instanceof UnauthorizedError;
        if (unauthorized) this.pause();
        this.update({ loading: false, error: failure.message, failure, unauthorized });
      },
    );
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private update(value: Partial<AdminResourceState<T>>) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }

  setInterval(interval: number | null) {
    if (this.interval === interval) return;
    this.interval = interval;
    this.schedule();
  }

  setRetryOnError(enabled: boolean, maxRetries = Infinity) {
    if (this.retryOnError === enabled && this.maxRetries === maxRetries) return;
    this.retryOnError = enabled;
    this.maxRetries = maxRetries;
    this.schedule();
  }

  resume() {
    if (this.state.unauthorized) return;
    this.cancel();
    this.active = true;
    void this.refresh();
  }

  pause() {
    this.active = false;
    this.cancel();
  }

  private cancel() {
    this.generation++;
    clearTimeout(this.timer);
    this.request.cancel();
    this.reading = false;
    if (this.state.refreshing) this.update({ refreshing: false });
  }

  refresh = async (): Promise<void> => {
    if (!this.active || this.state.unauthorized) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.reading = true;
    this.update({ loading: !this.state.ready, refreshing: this.state.ready });
    await this.request.refresh();
    if (generation !== this.generation) return;
    this.reading = false;
    this.update({ refreshing: false });
    this.schedule();
  };

  invalidate = async (): Promise<void> => {
    this.cancel();
    await this.refresh();
  };

  setData = (value: SetStateAction<T>) => {
    this.cancel();
    const data = typeof value === "function" ? (value as (current: T) => T)(this.state.data) : value;
    this.update({ data });
    this.schedule();
  };

  private schedule() {
    clearTimeout(this.timer);
    if (!this.active || this.reading || this.state.unauthorized) return;
    let delay = this.interval;
    if (this.state.failure) {
      if (!this.retryOnError || this.failures > this.maxRetries || !retryable(this.state.failure)) return;
      delay = Math.min(30_000, (this.interval ?? 1000) * 2 ** Math.min(this.failures, 5));
    }
    if (delay !== null) this.timer = setTimeout(() => { void this.refresh(); }, delay);
  }
}
