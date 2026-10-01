import type Artplayer from "artplayer";
import { nativeBackHandlers, supportsNativeBack } from "./nativeBack";

type NativeBackPlayer = Pick<Artplayer, "fullscreenWeb" | "setting" | "on" | "off">;

/** Web fullscreen is a page layer; native fullscreen is closed by Chrome first. */
export function bindPlayerNativeBack(art: NativeBackPlayer) {
  if (!supportsNativeBack()) return () => {};
  let releaseFullscreen: (() => void) | undefined;
  let releaseSettings: (() => void) | undefined;

  function syncFullscreen() {
    if (art.fullscreenWeb && !releaseFullscreen) {
      releaseFullscreen = nativeBackHandlers.register(() => {
        if (!art.fullscreenWeb) return false;
        art.fullscreenWeb = false;
      }, "fullscreen");
    } else if (!art.fullscreenWeb && releaseFullscreen) {
      releaseFullscreen();
      releaseFullscreen = undefined;
    }
  }

  function syncSettings() {
    if (art.setting.show && !releaseSettings) {
      releaseSettings = nativeBackHandlers.register(() => {
        if (!art.setting.show) return false;
        art.setting.show = false;
      }, "menu");
    } else if (!art.setting.show && releaseSettings) {
      releaseSettings();
      releaseSettings = undefined;
    }
  }

  art.on("fullscreenWeb", syncFullscreen);
  art.on("setting", syncSettings);
  syncFullscreen();
  syncSettings();
  return () => {
    art.off("fullscreenWeb", syncFullscreen);
    art.off("setting", syncSettings);
    releaseFullscreen?.();
    releaseSettings?.();
  };
}
