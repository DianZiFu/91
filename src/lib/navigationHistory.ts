/** Only navigate back across entries observed in this document. No router or
 * browser-private history indices are needed, including for sheet entries. */
export class NavigationHistory {
  private keys: string[] = [];
  private index = -1;

  record(key: string, action: "POP" | "PUSH" | "REPLACE") {
    if (this.keys[this.index] === key) return;
    if (action === "POP") {
      const index = this.keys.indexOf(key);
      if (index >= 0) {
        this.index = index;
        return;
      }
      this.keys = [key];
      this.index = 0;
    } else if (action === "REPLACE" && this.index >= 0) {
      this.keys[this.index] = key;
    } else {
      this.keys.splice(this.index + 1, Infinity, key);
      this.index += 1;
    }
  }

  backDelta(currentKey: string, targetKey: string): number | null {
    if (this.keys[this.index] !== currentKey) return null;
    const target = this.keys.indexOf(targetKey);
    return target >= 0 && target < this.index ? target - this.index : null;
  }

  isCurrent(key: string): boolean {
    return this.keys[this.index] === key;
  }

  canGoBack(key: string): boolean {
    return this.isCurrent(key) && this.index > 0;
  }
}

export const navigationHistory = new NavigationHistory();

type RouterHistoryState = {
  location: { key: string };
  historyAction: "POP" | "PUSH" | "REPLACE";
};

type ObservableRouterHistory = {
  state: RouterHistoryState;
  subscribe(listener: (state: RouterHistoryState) => void): () => void;
};

/** Record every committed router transition before React can batch renders.
 * Replace-then-push flows must retain the intermediate replacement entry. */
export function observeNavigationHistory(
  router: ObservableRouterHistory,
  history = navigationHistory
) {
  const record = (state: RouterHistoryState) => {
    history.record(state.location.key, state.historyAction);
  };
  record(router.state);
  return router.subscribe(record);
}
