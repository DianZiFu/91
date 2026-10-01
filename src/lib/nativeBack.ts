export type NativeBackHandler = () => void | boolean;
export type NativeBackPriority = "fullscreen" | "menu" | "dialog";

const priorities: Record<NativeBackPriority, number> = {
  fullscreen: 0,
  menu: 1,
  dialog: 2,
};

/** Android close requests must have one browser listener. Individual surfaces
 * register their close action here so one request closes just the top layer. */
class NativeBackHandlers {
  private entries: { handler: NativeBackHandler; priority: number; order: number }[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private nextOrder = 0;

  getSnapshot = () => this.version;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  refresh() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  register(handler: NativeBackHandler, priority: NativeBackPriority = "dialog") {
    const entry = { handler, priority: priorities[priority], order: this.nextOrder++ };
    this.entries.push(entry);
    this.refresh();
    return () => {
      const index = this.entries.indexOf(entry);
      if (index < 0) return;
      this.entries.splice(index, 1);
      this.refresh();
    };
  }

  hasHandlers() {
    return this.entries.length > 0;
  }

  handle(): boolean {
    const candidates = [...this.entries].sort(
      (left, right) => right.priority - left.priority || right.order - left.order
    );
    for (const entry of candidates) {
      if (this.entries.includes(entry) && entry.handler() !== false) return true;
    }
    return false;
  }
}

export const nativeBackHandlers = new NativeBackHandlers();

export type NativeCloseWatcher = EventTarget & { destroy(): void };
type NativeCloseWatcherConstructor = new () => NativeCloseWatcher;

export function getNativeCloseWatcher(): NativeCloseWatcherConstructor | undefined {
  // On desktop CloseWatcher receives Escape, which must not navigate history.
  if (typeof window === "undefined" || !/Android/i.test(window.navigator.userAgent)) {
    return undefined;
  }
  return (window as Window & { CloseWatcher?: NativeCloseWatcherConstructor }).CloseWatcher;
}

export function supportsNativeBack(): boolean {
  return getNativeCloseWatcher() !== undefined;
}
