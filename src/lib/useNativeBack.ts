import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { navigationHistory } from "./navigationHistory";
import {
  getNativeCloseWatcher,
  nativeBackHandlers,
  supportsNativeBack,
  type NativeBackHandler,
  type NativeBackPriority,
} from "./nativeBack";
import { useRouteActivity } from "./routeActivity";

/** Register only visible surfaces; retained background routes cannot consume back. */
export function useNativeBackHandler(
  active: boolean,
  onBack: NativeBackHandler,
  priority: NativeBackPriority = "dialog"
) {
  const routeActive = useRouteActivity();
  const onBackRef = useRef(onBack);
  useLayoutEffect(() => { onBackRef.current = onBack; });
  useLayoutEffect(() => {
    if (!active || !routeActive || !supportsNativeBack()) return;
    return nativeBackHandlers.register(() => onBackRef.current(), priority);
  }, [active, priority, routeActive]);
}

/** One application-level watcher handles overlays before immediate history back.
 * Chrome resolves native fullscreen exit before delivering these close requests. */
export function useNativeBackNavigation() {
  const { key } = useLocation();
  const navigate = useNavigate();
  const version = useSyncExternalStore(
    nativeBackHandlers.subscribe,
    nativeBackHandlers.getSnapshot,
    nativeBackHandlers.getSnapshot
  );
  const pendingKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => { pendingKeyRef.current = null; }, [key]);
  useLayoutEffect(() => {
    const CloseWatcher = getNativeCloseWatcher();
    if (
      !CloseWatcher ||
      pendingKeyRef.current === key ||
      (!nativeBackHandlers.hasHandlers() && !navigationHistory.canGoBack(key))
    ) {
      return;
    }

    const watcher = new CloseWatcher();
    const handleClose = () => {
      if (!navigationHistory.isCurrent(key) || pendingKeyRef.current === key) return;
      if (nativeBackHandlers.handle()) {
        // CloseWatcher is consumed even if a saving dialog cannot close yet.
        // Rearm without adding history or also navigating the underlying page.
        nativeBackHandlers.refresh();
      } else if (navigationHistory.canGoBack(key)) {
        pendingKeyRef.current = key;
        navigate(-1);
      }
    };
    watcher.addEventListener("close", handleClose, { once: true });
    return () => {
      watcher.removeEventListener("close", handleClose);
      watcher.destroy();
    };
  }, [key, navigate, version]);
}
