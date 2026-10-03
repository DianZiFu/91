// A refresh arriving during a read requests one follow-up read. Completed
// responses still apply; timer ticks never cancel a healthy slow request.
export class RefreshRequest<T> {
  private flight: { controller: AbortController; pending: boolean; promise: Promise<void> } | null = null;

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T>,
    private readonly onValue: (value: T) => void,
    private readonly onError: (error: unknown) => void,
    private readonly timeoutMs = 10_000,
  ) {}

  refresh(): Promise<void> {
    if (this.flight) {
      this.flight.pending = true;
      return this.flight.promise;
    }
    const flight = { controller: new AbortController(), pending: false, promise: Promise.resolve() };
    this.flight = flight;
    flight.promise = this.run(flight);
    return flight.promise;
  }

  cancel(): void {
    const flight = this.flight;
    this.flight = null;
    flight?.controller.abort();
  }

  private async run(flight: NonNullable<RefreshRequest<T>["flight"]>): Promise<void> {
    do {
      flight.pending = false;
      flight.controller = new AbortController();
      const controller = flight.controller;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => undefined;
      try {
        const interrupted = new Promise<never>((_, reject) => {
          abort = () => reject(new DOMException("Request canceled", "AbortError"));
          controller.signal.addEventListener("abort", abort, { once: true });
          timeout = setTimeout(() => {
            reject(new Error("数据刷新超时，请重试"));
            controller.abort();
          }, this.timeoutMs);
        });
        const value = await Promise.race([this.load(controller.signal), interrupted]);
        if (this.flight === flight && !controller.signal.aborted) this.onValue(value);
      } catch (error) {
        if (this.flight === flight) this.onError(error);
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
      }
    } while (this.flight === flight && flight.pending);
    if (this.flight === flight) this.flight = null;
  }
}
