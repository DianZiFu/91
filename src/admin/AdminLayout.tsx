import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useNativeBackHandler } from "@/lib/useNativeBack";
import "@/styles/admin-controls.css";
import "@/styles/admin.css";
import {
  ArchiveRestore,
  HardDrive,
  Menu,
  ScrollText,
  SlidersHorizontal,
  Tags,
  Users,
  X,
} from "lucide-react";
import { VideoIcon } from "@/components/icons/VideoIcon";
import { TelegramIcon } from "@/components/icons/TelegramIcon";
import * as api from "./api";
import { AdminGlobalActions } from "./AdminGlobalActions";
import { AdminPageActionsProvider } from "./AdminPageActions";
import { AdminRouteCache, getAdminRouteCacheKey } from "./AdminRouteCache";
import { useAuth } from "./AuthContext";
import { useToast } from "@/components/ToastContext";
import { Modal } from "./Modal";
import { getAdminPageTitle, shouldShowAdminPageHeader } from "./adminPageTitle";
import { preloadRemainingAdminPageModules } from "./adminPagePreload";
import { SpiderIcon } from "./icons/SpiderIcon";
import { useTelegramAvailability } from "./telegram/useTelegramAvailability";
import { TelegramStatusProvider } from "./telegram/TelegramStatusProvider";
import {
  resolveAdminScrollTarget,
  type AdminScrollRouteIdentity,
} from "./adminScrollRestoration";

const ADMIN_MOBILE_MEDIA_QUERY = "(max-width: 768px)";
type AdminScrollOwner = "document" | "main";

function getAdminScrollOwner(mediaQuery?: MediaQueryList): AdminScrollOwner {
  return (mediaQuery ?? window.matchMedia(ADMIN_MOBILE_MEDIA_QUERY)).matches
    ? "document"
    : "main";
}

function readAdminScrollTop(owner: AdminScrollOwner, main: HTMLElement | null) {
  return owner === "document" ? window.scrollY : main?.scrollTop ?? 0;
}

function writeAdminScrollTop(
  owner: AdminScrollOwner,
  main: HTMLElement | null,
  scrollTop: number
) {
  if (owner === "document") {
    window.scrollTo({ top: scrollTop, left: 0, behavior: "auto" });
  } else {
    main?.scrollTo({ top: scrollTop, left: 0, behavior: "auto" });
  }
}

function useAdminPageModulePreload(pathname: string) {
  const preloadOriginRef = useRef<string | null>(null);
  const activePath = getAdminRouteCacheKey(pathname);
  if (preloadOriginRef.current === null && activePath) {
    preloadOriginRef.current = activePath;
  }
  const preloadOrigin = preloadOriginRef.current;

  useEffect(() => {
    if (!preloadOrigin) return;
    return preloadRemainingAdminPageModules(preloadOrigin);
  }, [preloadOrigin]);
}

export function AdminLayout() {
  const location = useLocation();
  const { invalidateSession } = useAuth();
  return (
    <TelegramStatusProvider workspaceActive={location.pathname.startsWith("/admin/telegram")} onUnauthorized={invalidateSession}>
      <AdminLayoutContent />
    </TelegramStatusProvider>
  );
}

function AdminLayoutContent() {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { show } = useToast();
  const isLogsPage = location.pathname.startsWith("/admin/logs");
  const isTelegramPage = location.pathname.startsWith("/admin/telegram");
  const currentPageTitle = getAdminPageTitle(location.pathname);
  const showCurrentPageHeader = shouldShowAdminPageHeader(
    location.pathname,
    location.search
  );
  const mobileNavigationToggleRef = useRef<HTMLButtonElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const pageContentRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const activeScrollRouteRef = useRef<AdminScrollRouteIdentity | null>(null);
  const activeScrollTopRef = useRef(0);
  const scrollOwnerRef = useRef<AdminScrollOwner | null>(null);
  const pendingScrollRestoreRef = useRef<{ key: string; top: number } | null>(null);
  const [pageActionsTarget, setPageActionsTarget] = useState<HTMLDivElement | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<api.UpdateCheck | null>(null);
  useNativeBackHandler(mobileNavigationOpen, () => {
    setMobileNavigationOpen(false);
    window.requestAnimationFrame(() => mobileNavigationToggleRef.current?.focus());
  }, "menu");

  useAdminPageModulePreload(location.pathname);
  const { enabled: telegramEnabled } = useTelegramAvailability();

  useEffect(() => {
    document.title = currentPageTitle;
  }, [currentPageTitle]);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    const main = mainScrollRef.current;
    const mediaQuery = window.matchMedia(ADMIN_MOBILE_MEDIA_QUERY);
    let transferFrame = 0;
    scrollOwnerRef.current ??= getAdminScrollOwner(mediaQuery);

    function saveActiveScrollPosition(owner: AdminScrollOwner) {
      const activeRoute = activeScrollRouteRef.current;
      if (!activeRoute) return;
      // Ignore events emitted by the container that is becoming inactive while
      // a media-query transition swaps the scroll owner.
      if (
        scrollOwnerRef.current !== owner ||
        getAdminScrollOwner(mediaQuery) !== owner
      ) {
        return;
      }

      const scrollTop = readAdminScrollTop(owner, main);
      const pendingRestore = pendingScrollRestoreRef.current;
      if (
        pendingRestore?.key === activeRoute.key &&
        Math.abs(scrollTop - pendingRestore.top) > 1
      ) {
        return;
      }
      if (pendingRestore?.key === activeRoute.key) {
        pendingScrollRestoreRef.current = null;
      }
      activeScrollTopRef.current = scrollTop;
      scrollPositionsRef.current.set(activeRoute.key, scrollTop);
    }

    function saveDocumentScrollPosition() {
      saveActiveScrollPosition("document");
    }

    function saveMainScrollPosition() {
      saveActiveScrollPosition("main");
    }

    function handleScrollOwnerChange(event: MediaQueryListEvent) {
      const nextOwner: AdminScrollOwner = event.matches ? "document" : "main";
      if (scrollOwnerRef.current === nextOwner) return;

      const activeRoute = activeScrollRouteRef.current;
      const scrollTop = activeScrollTopRef.current;
      scrollOwnerRef.current = nextOwner;
      if (activeRoute) {
        scrollPositionsRef.current.set(activeRoute.key, scrollTop);
        pendingScrollRestoreRef.current =
          scrollTop > 0 ? { key: activeRoute.key, top: scrollTop } : null;
      }

      window.cancelAnimationFrame(transferFrame);
      transferFrame = window.requestAnimationFrame(() => {
        if (
          scrollOwnerRef.current !== nextOwner ||
          activeScrollRouteRef.current?.key !== activeRoute?.key
        ) {
          return;
        }
        writeAdminScrollTop(nextOwner, main, scrollTop);
        const restoredScrollTop = readAdminScrollTop(nextOwner, main);
        activeScrollTopRef.current = restoredScrollTop;
        if (activeRoute) {
          scrollPositionsRef.current.set(activeRoute.key, restoredScrollTop);
          pendingScrollRestoreRef.current = null;
        }
      });
    }

    window.addEventListener("scroll", saveDocumentScrollPosition, { passive: true });
    main?.addEventListener("scroll", saveMainScrollPosition, { passive: true });
    mediaQuery.addEventListener("change", handleScrollOwnerChange);

    return () => {
      window.cancelAnimationFrame(transferFrame);
      window.removeEventListener("scroll", saveDocumentScrollPosition);
      main?.removeEventListener("scroll", saveMainScrollPosition);
      mediaQuery.removeEventListener("change", handleScrollOwnerChange);
    };
  }, []);

  useLayoutEffect(() => {
    const routeKey = location.key;
    const main = mainScrollRef.current;
    const pageContent = pageContentRef.current;
    const scrollOwner = getAdminScrollOwner();
    const previousRoute = activeScrollRouteRef.current;
    const currentScrollTop = previousRoute
      ? activeScrollTopRef.current
      : readAdminScrollTop(scrollOwner, main);
    const previousRestore = pendingScrollRestoreRef.current;

    if (
      previousRoute &&
      previousRoute.key !== routeKey &&
      !(
        previousRestore?.key === previousRoute.key &&
        Math.abs(currentScrollTop - previousRestore.top) > 1
      )
    ) {
      scrollPositionsRef.current.set(previousRoute.key, currentScrollTop);
    }

    const targetScrollTop = resolveAdminScrollTarget({
      previousRoute,
      nextPathname: location.pathname,
      storedScrollTop: scrollPositionsRef.current.get(routeKey),
      currentScrollTop,
    });
    scrollOwnerRef.current = scrollOwner;
    activeScrollRouteRef.current = {
      key: routeKey,
      pathname: location.pathname,
    };
    scrollPositionsRef.current.set(routeKey, targetScrollTop);

    function readScrollTop() {
      return readAdminScrollTop(scrollOwnerRef.current ?? scrollOwner, main);
    }

    function writeScrollTop() {
      writeAdminScrollTop(scrollOwnerRef.current ?? scrollOwner, main, targetScrollTop);
    }

    let retryFrame = 0;
    let retryTimeout = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    function stopRetrying() {
      window.cancelAnimationFrame(retryFrame);
      window.clearTimeout(retryTimeout);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    }

    function restoreWhenReady() {
      if (activeScrollRouteRef.current?.key !== routeKey) {
        stopRetrying();
        return;
      }

      writeScrollTop();
      const restoredScrollTop = readScrollTop();
      activeScrollTopRef.current = restoredScrollTop;
      if (Math.abs(restoredScrollTop - targetScrollTop) <= 1) {
        pendingScrollRestoreRef.current = null;
        scrollPositionsRef.current.set(routeKey, restoredScrollTop);
        stopRetrying();
      }
    }

    function scheduleRestore() {
      window.cancelAnimationFrame(retryFrame);
      retryFrame = window.requestAnimationFrame(restoreWhenReady);
    }

    pendingScrollRestoreRef.current =
      targetScrollTop > 0 ? { key: routeKey, top: targetScrollTop } : null;
    restoreWhenReady();

    if (targetScrollTop > 0 && readScrollTop() < targetScrollTop - 1) {
      if (pageContent) {
        resizeObserver = new ResizeObserver(scheduleRestore);
        resizeObserver.observe(pageContent);
        mutationObserver = new MutationObserver(scheduleRestore);
        mutationObserver.observe(pageContent, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
      retryTimeout = window.setTimeout(() => {
        pendingScrollRestoreRef.current = null;
        const restoredScrollTop = readScrollTop();
        activeScrollTopRef.current = restoredScrollTop;
        scrollPositionsRef.current.set(routeKey, restoredScrollTop);
        stopRetrying();
      }, 10_000);
    }

    return stopRetrying;
  }, [location.key, location.pathname]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    const root = document.documentElement;
    const body = document.body;
    root.classList.add("admin-mobile-nav-open");
    body.classList.add("admin-mobile-nav-open");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileNavigationOpen(false);
      window.requestAnimationFrame(() => mobileNavigationToggleRef.current?.focus());
    }

    function handleResize() {
      if (window.innerWidth > 768) setMobileNavigationOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      root.classList.remove("admin-mobile-nav-open");
      body.classList.remove("admin-mobile-nav-open");
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileNavigationOpen]);

  async function handleCheckUpdate() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await api.checkUpdate();
      if (result.hasUpdate) {
        setAvailableUpdate(result);
        return;
      }
      if (result.currentVersion === "unknown") {
        show(`当前版本未知，GitHub 最新版本为 ${result.latestVersion}`, "info");
        return;
      }
      show(`当前已是最新版本：${result.currentVersion}`, "success");
    } catch {
      show("检查更新失败，请稍后重试", "error");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      show("已退出登录", "success");
      navigate("/login", { replace: true });
    } catch {
      show("退出失败", "error");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="admin-shell">
      <button
        ref={mobileNavigationToggleRef}
        type="button"
        className={`admin-mobile-nav-toggle${mobileNavigationOpen ? " is-open" : ""}`}
        onClick={() => setMobileNavigationOpen((open) => !open)}
        title={mobileNavigationOpen ? "关闭后台菜单" : "打开后台菜单"}
        aria-label={mobileNavigationOpen ? "关闭后台菜单" : "打开后台菜单"}
        aria-controls="admin-navigation"
        aria-expanded={mobileNavigationOpen}
      >
        {mobileNavigationOpen ? (
          <X size={18} aria-hidden="true" />
        ) : (
          <Menu size={18} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className={`admin-mobile-nav-backdrop${mobileNavigationOpen ? " is-visible" : ""}`}
        onClick={() => {
          setMobileNavigationOpen(false);
          window.requestAnimationFrame(() => mobileNavigationToggleRef.current?.focus());
        }}
        aria-label="关闭后台菜单"
        aria-hidden={!mobileNavigationOpen}
        tabIndex={mobileNavigationOpen ? 0 : -1}
      />
      <aside
        id="admin-navigation"
        className={`admin-sidebar${mobileNavigationOpen ? " is-open" : ""}`}
        aria-label="后台导航"
      >
        <nav className="admin-nav" onClick={() => setMobileNavigationOpen(false)}>
          <div className="admin-nav__group">
            <span className="admin-nav__group-label">资源</span>
            <NavLink
              to="/admin/drives"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <HardDrive size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">网盘管理</span>
              </span>
            </NavLink>
            <NavLink
              to="/admin/crawlers"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <SpiderIcon size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">爬虫管理</span>
              </span>
            </NavLink>
            {telegramEnabled === true && (
              <NavLink
                to="/admin/telegram"
                className={({ isActive }) =>
                  `admin-nav__link ${isActive ? "is-active" : ""}`
                }
              >
                <span className="admin-nav__icon" aria-hidden="true">
                  <TelegramIcon size={15} />
                </span>
                <span className="admin-nav__text">
                  <span className="admin-nav__title">Telegram</span>
                </span>
              </NavLink>
            )}
          </div>
          <div className="admin-nav__group">
            <span className="admin-nav__group-label">管理</span>
            <NavLink
              to="/admin/videos"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <VideoIcon size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">视频管理</span>
              </span>
            </NavLink>
            <NavLink
              to="/admin/tags"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <Tags size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">标签管理</span>
              </span>
            </NavLink>
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <Users size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">用户管理</span>
              </span>
            </NavLink>
          </div>
          <div className="admin-nav__group">
            <span className="admin-nav__group-label">系统</span>
            <NavLink
              to="/admin/backup"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <ArchiveRestore size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">备份恢复</span>
              </span>
            </NavLink>
            <NavLink
              to="/admin/logs"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <ScrollText size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">日志查看</span>
              </span>
            </NavLink>
            <NavLink
              to="/admin/settings"
              className={({ isActive }) =>
                `admin-nav__link ${isActive ? "is-active" : ""}`
              }
            >
              <span className="admin-nav__icon" aria-hidden="true">
                <SlidersHorizontal size={15} />
              </span>
              <span className="admin-nav__text">
                <span className="admin-nav__title">配置面板</span>
              </span>
            </NavLink>
          </div>
        </nav>
      </aside>
      <AdminGlobalActions
        checkingUpdate={checkingUpdate}
        loggingOut={loggingOut}
        onCheckUpdate={() => void handleCheckUpdate()}
        onLogout={() => void handleLogout()}
      />
      <main
        ref={mainScrollRef}
        className={`admin-main${isLogsPage ? " admin-main--logs" : ""}${isTelegramPage ? " admin-main--telegram" : ""}`}
      >
        {showCurrentPageHeader && (
          <header className="admin-current-page-header">
            <h1 className="admin-page__title" aria-live="polite">
              {currentPageTitle}
            </h1>
            <div
              ref={setPageActionsTarget}
              className="admin-current-page-actions"
              aria-label="当前页面操作"
            />
          </header>
        )}
        <AdminPageActionsProvider target={pageActionsTarget}>
          <div
            ref={pageContentRef}
            className={`admin-page-content${isLogsPage ? " admin-page-content--logs" : ""}`}
          >
            <AdminRouteCache />
          </div>
        </AdminPageActionsProvider>
      </main>
      {availableUpdate && (
        <Modal
          open
          title={`发现新版本 ${availableUpdate.latestVersion}`}
          className="admin-modal--release-notes"
          onClose={() => setAvailableUpdate(null)}
          footer={
            availableUpdate.releaseUrl ? (
              <a
                className="admin-btn is-primary"
                href={availableUpdate.releaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看发布页
              </a>
            ) : undefined
          }
        >
          <div className="admin-release-notes">
            <div className="admin-release-notes__versions">
              <span>当前版本：{availableUpdate.currentVersion}</span>
              <span>最新版本：{availableUpdate.latestVersion}</span>
            </div>
            <section className="admin-release-notes__content" aria-label="Release Note">
              <h3>Release Note</h3>
              <div>{availableUpdate.releaseNotes?.trim() || "该版本未提供 Release Note。"}</div>
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}
