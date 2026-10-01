import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { routeToPath } from "@/lib/videoReturnPath";
import { exitShortsFullscreen } from "./fullscreen";
import { useShortsFullscreen } from "./useShortsFullscreen";

type ShortsPlaybackMode = "normal" | "clear";

/**
 * 将返回顺序表达为路由历史：首页 → 正常播放 → 清屏播放。
 * 清屏和正常态共用 /shorts 和同一个播放器，只让路由 state 改变覆盖层。
 */
export function useShortsNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;
  const mode = (location.state as { shortsPlayback?: ShortsPlaybackMode } | null)
    ?.shortsPlayback;
  const ready = mode === "normal" || mode === "clear";
  const clearScreen = mode === "clear";
  const initializingRef = useRef(false);
  const navigatingRef = useRef(false);
  const fullscreen = useShortsFullscreen();
  const wasFullscreenRef = useRef(fullscreen.isFullscreen);

  useEffect(() => {
    navigatingRef.current = false;
    if (ready) {
      initializingRef.current = false;
      return;
    }
    // 首次打开（包括直接访问 URL）先准备首页落点，再挂载真正的播放器。
    // 两次路由更新在同一批次内完成，中间不会渲染首页或重启视频。
    // ref 防止 StrictMode 重放 effect 时重复插入历史。
    if (initializingRef.current) return;
    initializingRef.current = true;
    navigate("/", { replace: true });
    navigate(routeToPath(location), { state: { shortsPlayback: "normal" } });
  }, [location, navigate, ready]);

  const setClearScreen = useCallback((clear: boolean) => {
    const current = locationRef.current;
    if (clear === (current.state?.shortsPlayback === "clear") || navigatingRef.current) return;
    navigatingRef.current = true;
    if (clear) {
      navigate(routeToPath(current), { state: { shortsPlayback: "clear" } });
    } else {
      // 捏合和系统返回消耗同一层历史，反复清屏不会堆积额外的返回步骤。
      navigate(-1);
    }
  }, [navigate]);

  useEffect(() => {
    const exited = wasFullscreenRef.current && !fullscreen.isFullscreen;
    wasFullscreenRef.current = fullscreen.isFullscreen;
    // 原生返回优先由浏览器退出全屏。这里只恢复控件，保留当前视频；
    // 不把切换应用等造成的全屏退出误当作“离开短视频”。
    // 与路由更新一起提交后再判定，避免 popstate 已关闭清屏时再次后退。
    if (exited && ready && clearScreen) setClearScreen(false);
  }, [clearScreen, fullscreen.isFullscreen, ready, setClearScreen]);

  const handleBackToHomeClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    const steps = locationRef.current.state?.shortsPlayback === "clear" ? -2 : -1;
    void exitShortsFullscreen().then(() => navigate(steps));
  }, [navigate]);

  const handleRouteClick = useCallback((event: MouseEvent<HTMLAnchorElement>, destination: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    void exitShortsFullscreen().then(() => navigate(destination));
  }, [navigate]);

  return { ready, clearScreen, setClearScreen, handleBackToHomeClick, handleRouteClick, ...fullscreen };
}
