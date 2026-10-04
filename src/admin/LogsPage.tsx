import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import * as api from "./api";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "@/components/ToastContext";
import { useNativeBackHandler } from "@/lib/useNativeBack";
import { useLogScroller } from "./useLogScroller";
import { useRuntimeLogs } from "./useRuntimeLogs";
import {
  useAdminRouteActive,
  useAdminRouteRevalidation,
} from "./AdminRouteCache";
import { copyTextToClipboard } from "../lib/clipboard";

const AUTO_REFRESH_STORAGE_KEY = "admin.logs.autoRefresh";
const EMPTY_LOG_ENTRIES: api.AdminLogEntry[] = [];
const contextKeys = ["component", "requestId", "taskId", "driveId", "videoId", "fileId", "stage"] as const;

function initialAutoRefreshPreference() {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

const levelLabels: Record<api.AdminLogLevel, string> = {
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
};

const sourceLabels: Record<api.AdminLogSource, string> = {
  application: "应用",
  http: "访问",
};

const sourceOptions: Array<{
  value: api.AdminLogSource | "";
  label: string;
}> = [
  { value: "", label: "ALL" },
  { value: "application", label: "应用" },
  { value: "http", label: "访问" },
];

const levelOptions: Array<{
  value: api.AdminLogLevel | "";
  label: string;
}> = [
  { value: "", label: "ALL" },
  { value: "info", label: "INFO" },
  { value: "warning", label: "WARN" },
  { value: "error", label: "ERROR" },
];

const methodOptions: Array<{
  value: api.AdminLogMethod | "";
  label: string;
}> = [
  { value: "", label: "ALL" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
  { value: "OPTIONS", label: "OPTIONS" },
  { value: "HEAD", label: "HEAD" },
];

type ParsedHTTPAccessLog = {
  requestId?: string;
  method: string;
  path: string;
  remote: string;
  status: number;
  bytes: number;
  elapsed: string;
};

const httpAccessPattern =
  /^(?:\[([^\]]+)\]\s+)?"([A-Z]+)\s+(\S+)\s+HTTP\/[^\"]+"\s+from\s+(.+?)\s+-\s+([1-5]\d{2})\s+(\d+)B\s+in\s+(.+)$/;

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

function formatRawLine(entry: api.AdminLogEntry) {
  const context = contextKeys.filter((key) => entry[key]).map((key) => `${key}=${JSON.stringify(entry[key])}`).join(" ");
  const error = entry.error ? ` error=${entry.error}` : "";
  const stack = entry.stack ? `\n${entry.stack}` : "";
  return `${formatTimestamp(entry.timestamp)} [${levelLabels[entry.level]}] [${entry.source}] ${context ? `${context} ` : ""}${entry.message}${error}${stack}`;
}

function formatByteCount(value: number) {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
}

export function parseHTTPAccessLog(message: string): ParsedHTTPAccessLog | null {
  const match = message.match(httpAccessPattern);
  if (!match) return null;

  let requestPath = match[3];
  try {
    const requestURL = new URL(match[3]);
    requestPath = `${requestURL.pathname}${requestURL.search}`;
  } catch {
    // Keep the original target when a proxy emits an origin-form URL.
  }

  return {
    requestId: match[1] || undefined,
    method: match[2],
    path: requestPath,
    remote: match[4],
    status: Number(match[5]),
    bytes: Number(match[6]),
    elapsed: match[7],
  };
}

export function structuredHTTPAccessLog(
  entry: api.AdminLogEntry
): ParsedHTTPAccessLog | null {
  if (entry.source !== "http") return null;
  const fallback = parseHTTPAccessLog(entry.message);
  const method = entry.method ?? fallback?.method;
  const path = entry.path ?? fallback?.path;
  const status = entry.status ?? fallback?.status;
  if (!method || !path || status === undefined) return fallback;
  return {
    requestId: entry.requestId ?? fallback?.requestId,
    method,
    path,
    remote: entry.remote ?? fallback?.remote ?? "-",
    status,
    bytes: entry.bytes ?? fallback?.bytes ?? 0,
    elapsed: entry.elapsed ?? fallback?.elapsed ?? "-",
  };
}

export type RuntimeLogViewFilters = {
  source: api.AdminLogSource | "";
  level: api.AdminLogLevel | "";
  method: api.AdminLogMethod | "";
  query: string;
};

export function filterRuntimeLogEntries(
  entries: api.AdminLogEntry[],
  filters: RuntimeLogViewFilters
) {
  const query = filters.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.source && entry.source !== filters.source) return false;
    if (filters.level && entry.level !== filters.level) return false;
    if (filters.method && entry.method !== filters.method) return false;
    if (!query) return true;

    const searchableText = [
      entry.timestamp,
      entry.source,
      entry.level,
      entry.method,
      entry.status,
      entry.path,
      entry.remote,
      entry.bytes,
      entry.elapsed,
      entry.requestId,
      entry.taskId, entry.component, entry.driveId, entry.videoId, entry.fileId, entry.stage, entry.error, entry.stack,
      entry.message,
    ]
      .filter((value) => value !== undefined)
      .join(" ")
      .toLowerCase();
    return searchableText.includes(query);
  });
}

function LogToggle({
  checked,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  icon: ReactNode;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`admin-log-toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      {icon}
      <span>{label}</span>
      <span className="admin-log-toggle__track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function LogsPage() {
  const { show } = useToast();
  const routeActive = useAdminRouteActive();
  const [source, setSource] = useState<api.AdminLogSource | "">("");
  const [level, setLevel] = useState<api.AdminLogLevel | "">("");
  const [method, setMethod] = useState<api.AdminLogMethod | "">("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);
  const downloadControllerRef = useRef<AbortController | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const [serverSearch, setServerSearch] = useState(deferredSearch);
  useEffect(() => {
    const timer = window.setTimeout(() => setServerSearch(deferredSearch), 250);
    return () => window.clearTimeout(timer);
  }, [deferredSearch]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefreshPreference);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenActive = fullscreen && routeActive;
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const inlineLogViewerSlotRef = useRef<HTMLDivElement>(null);
  const [logViewerHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const host = document.createElement("div");
    host.className = "admin-log-viewer-host";
    return host;
  });
  const filters = useMemo<api.AdminLogFilters>(() => ({
    source: source || undefined,
    level: level || undefined,
    method: method || undefined,
    query: serverSearch,
  }), [source, level, method, serverSearch]);
  const {
    snapshot,
    loading,
    refreshing,
    error,
    reload,
    resetAfterClear,
    loadingOlder,
    viewingHistory,
    loadOlder,
  } = useRuntimeLogs({ autoRefresh: autoRefresh && routeActive, filters });
  const searchPending = search.trim() !== deferredSearch || deferredSearch !== serverSearch;
  const logsBusy = loading || refreshing || loadingOlder || searchPending;
  useEffect(() => () => downloadControllerRef.current?.abort(), []);
  useAdminRouteRevalidation(() => {
    void reload();
  });
  const bufferedEntries = snapshot?.entries ?? EMPTY_LOG_ENTRIES;
  const matchingEntries = useMemo(
    () =>
      filterRuntimeLogEntries(bufferedEntries, {
        source,
        level,
        method,
        query: deferredSearch,
      }),
    [bufferedEntries, deferredSearch, level, method, source]
  );
  const filterViewKey = `${source}\u0000${level}\u0000${method}\u0000${deferredSearch}\u0000${viewingHistory ? snapshot?.entries[0]?.id : "latest"}`;

  useLayoutEffect(() => {
    if (!fullscreenActive) return;
    const html = document.documentElement;
    const body = document.body;
    const shell = document.querySelector<HTMLElement>(".admin-shell");
    const shellWasInert = shell?.inert ?? false;
    html.classList.add("admin-logs-fullscreen-active");
    body.classList.add("admin-logs-fullscreen-active");
    if (shell) shell.inert = true;
    return () => {
      html.classList.remove("admin-logs-fullscreen-active");
      body.classList.remove("admin-logs-fullscreen-active");
      if (shell) shell.inert = shellWasInert;
    };
  }, [fullscreenActive]);

  useLayoutEffect(() => {
    if (!logViewerHost) return;
    const target = fullscreenActive ? document.body : inlineLogViewerSlotRef.current;
    if (target && logViewerHost.parentNode !== target) {
      target.appendChild(logViewerHost);
    }
  }, [fullscreenActive, logViewerHost]);

  useEffect(
    () => () => {
      logViewerHost?.remove();
    },
    [logViewerHost]
  );

  const {
    viewportRef,
    visibleEntries: entries,
    hiddenEntryCount,
    canLoadMore,
    followTail,
    handleViewportScroll,
    enableFollowTail,
    prepareViewportTransition,
  } = useLogScroller({
    entries: matchingEntries,
    loading,
    viewKey: filterViewKey,
    showRawLogs,
    fullscreen: fullscreenActive,
  });
  useNativeBackHandler(fullscreenActive, () => {
    prepareViewportTransition();
    setFullscreen(false);
  }, "fullscreen");

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
    } catch {
      // Storage availability does not affect the active page session.
    }
  }, [autoRefresh]);

  useEffect(() => {
    if (!fullscreenActive) return;
    const focusFrame = window.requestAnimationFrame(() => {
      fullscreenButtonRef.current?.focus();
    });
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector(".admin-modal-backdrop")
      ) {
        prepareViewportTransition();
        setFullscreen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [fullscreenActive, prepareViewportTransition]);

  function toggleFullscreen() {
    prepareViewportTransition();
    setFullscreen((value) => !value);
  }

  async function copyLogLine(entry: api.AdminLogEntry) {
    const copied = await copyTextToClipboard(formatRawLine(entry));
    if (copied) {
      show("日志已复制", "success");
      return;
    }
    show("复制失败，请检查浏览器剪贴板权限", "error");
  }

  async function downloadMatchingLogs() {
    if (downloading) return;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    setDownloading(true);
    try {
      const blob = await api.downloadLogs(filters, controller.signal);
      const blobURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobURL;
      link.download = `runtime-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
      show("日志已导出", "success");
    } catch (downloadError) {
      if (!controller.signal.aborted) show(downloadError instanceof Error ? downloadError.message : "日志导出失败", "error");
    } finally {
      downloadControllerRef.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  async function clearRuntimeLogs() {
    if (clearing) return;
    setClearing(true);
    try {
      await api.clearLogs();
      resetAfterClear();
      setClearConfirmOpen(false);
      show("后台文件日志已清空", "success");
    } catch (clearError) {
      show(
        clearError instanceof Error ? clearError.message : "日志清空失败",
        "error"
      );
    } finally {
      setClearing(false);
    }
  }

  const activeStructuredFilterCount =
    Number(Boolean(source)) + Number(Boolean(level)) + Number(Boolean(method));
  const hasFilters = Boolean(source || level || method || deferredSearch);
  const rawVisibleText = useMemo(
    () => entries.map(formatRawLine).join("\n"),
    [entries]
  );

  const logViewer = (
    <section
      className={`admin-card admin-log-card ${fullscreenActive ? "is-fullscreen" : ""}`}
      role={fullscreenActive ? "dialog" : undefined}
      aria-modal={fullscreenActive ? true : undefined}
      aria-label="运行日志"
    >
        {error && (
          <div className="admin-log-error" role="alert">
            <strong>日志刷新失败</strong>
            <span>{error}</span>
          </div>
        )}
        {snapshot?.writeHealth?.lastError && (
          <div className="admin-log-error" role="alert">
            <strong>日志文件写入失败</strong>
            <span>{snapshot.writeHealth.lastError}</span>
          </div>
        )}

        <div className="admin-log-controls">
          {!fullscreenActive && (
            <>
              <label className="admin-log-search">
                <span className="sr-only">搜索日志</span>
                <input
                  type="search"
                  value={search}
                  maxLength={200}
                  placeholder="搜索日志内容"
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    className="admin-log-search__icon"
                    aria-label="清除搜索"
                    onClick={() => setSearch("")}
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <Search
                    size={16}
                    className="admin-log-search__indicator"
                    aria-hidden="true"
                  />
                )}
              </label>

              <button
                type="button"
                className="admin-btn admin-log-filter-toggle"
                aria-expanded={filtersExpanded}
                aria-controls="admin-log-structured-filters"
                onClick={() => setFiltersExpanded((value) => !value)}
              >
                <SlidersHorizontal size={16} />
                筛选
                {activeStructuredFilterCount > 0 && (
                  <span className="admin-log-filter-count">
                    {activeStructuredFilterCount}
                  </span>
                )}
                {filtersExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </>
          )}

          {!fullscreenActive && (
            <div
              id="admin-log-structured-filters"
              className={`admin-log-filter-panel${filtersExpanded ? " is-expanded" : ""}`}
            >
              <div className="admin-log-filter-panel__top">
                <div className="admin-log-filter-group">
                  <span className="admin-log-filter-label">来源</span>
                  <div className="admin-log-filter-chips">
                    {sourceOptions.map((option) => (
                      <button
                        key={option.value || "all"}
                        type="button"
                        className={`admin-log-filter-chip ${source === option.value ? "is-active" : ""}`}
                        aria-pressed={source === option.value}
                        onClick={() => setSource(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="admin-log-clear-filters"
                  disabled={activeStructuredFilterCount === 0}
                  onClick={() => {
                    setSource("");
                    setLevel("");
                    setMethod("");
                  }}
                >
                  清除筛选
                </button>
              </div>

              <div className="admin-log-filter-group">
                <span className="admin-log-filter-label">级别</span>
                <div className="admin-log-filter-chips">
                  {levelOptions.map((option) => (
                    <button
                      key={option.value || "all"}
                      type="button"
                      className={`admin-log-filter-chip ${level === option.value ? "is-active" : ""}`}
                      aria-pressed={level === option.value}
                      onClick={() => setLevel(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="admin-log-filter-group">
                <span className="admin-log-filter-label">请求方法</span>
                <div className="admin-log-filter-chips">
                  {methodOptions.map((option) => (
                    <button
                      key={option.value || "all"}
                      type="button"
                      className={`admin-log-filter-chip ${method === option.value ? "is-active" : ""}`}
                      aria-pressed={method === option.value}
                      onClick={() => setMethod(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}

          <div className="admin-log-control-row">
            <div className="admin-log-toggles">
              <LogToggle
                checked={showRawLogs}
                icon={<Code2 size={16} />}
                label="显示原始日志"
                onChange={setShowRawLogs}
              />
              <LogToggle
                checked={autoRefresh && !viewingHistory}
                icon={<Timer size={16} />}
                label="自动刷新"
                onChange={(value) => {
                  setAutoRefresh(value);
                  if (value && viewingHistory) void reload();
                }}
              />
            </div>

            <div className="admin-log-actions">
              <button
                type="button"
                className="admin-btn"
                disabled={loading || refreshing || clearing}
                onClick={() => void reload()}
              >
                <RefreshCw size={16} className={refreshing ? "admin-spin" : ""} />
                刷新日志
              </button>
              <button
                type="button"
                className="admin-btn"
                disabled={loading || downloading || clearing || searchPending}
                onClick={() => void downloadMatchingLogs()}
              >
                <Download size={16} />
                {downloading ? "导出中" : "下载日志"}
              </button>
              <button
                type="button"
                className="admin-btn is-danger"
                disabled={clearing || (snapshot?.storageBytes ?? 0) === 0}
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 size={16} />
                {clearing ? "清空中…" : "清空日志"}
              </button>
              <button
                ref={fullscreenButtonRef}
                type="button"
                className="admin-btn admin-log-fullscreen-toggle"
                aria-pressed={fullscreenActive}
                onClick={toggleFullscreen}
              >
                {fullscreenActive ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                {fullscreenActive ? "退出全屏" : "全屏查看"}
              </button>
            </div>
          </div>
        </div>

        <div className="admin-log-panel">
          <div
            ref={viewportRef}
            className="admin-log-panel__viewport"
            role="log"
            aria-label="日志条目"
            aria-busy={logsBusy}
            onScroll={handleViewportScroll}
          >
            {snapshot?.hasMore && !canLoadMore && (
              <button type="button" className="admin-btn admin-log-history" disabled={loadingOlder || refreshing} onClick={() => void loadOlder()}>
                <ChevronUp size={14} />{loadingOlder ? "加载中" : "更早记录"}
              </button>
            )}
            {logsBusy && entries.length === 0 ? (
              <div className="admin-log-loading" role="status">
                正在加载日志
              </div>
            ) : entries.length === 0 ? (
              !error && (
                <div className="admin-log-empty">
                  {viewingHistory ? "没有更早的日志" : hasFilters
                    ? "没有符合当前筛选条件的日志"
                    : "当前还没有产生可显示的日志"}
                </div>
              )
            ) : (
              <>
                {canLoadMore && (
                  <div className="admin-log-load-more">
                    <span>向上滚动加载更多</span>
                    <div className="admin-log-load-more__stats">
                      <span>已载入 {entries.length} 行</span>
                      <span>已隐藏 {hiddenEntryCount} 行</span>
                    </div>
                  </div>
                )}
                {showRawLogs ? (
                  <pre className="admin-log-raw" spellCheck={false}>
                    {rawVisibleText}
                  </pre>
                ) : (
                  <div className="admin-log-list">
                    {entries.map((entry) => {
                      const parsedHTTP = structuredHTTPAccessLog(entry);
                      return (
                        <div
                          className={`admin-log-row is-${entry.level}`}
                          key={entry.id}
                          data-log-entry-id={entry.id}
                          title="双击复制这条日志"
                          onDoubleClick={() => void copyLogLine(entry)}
                        >
                          <time dateTime={entry.timestamp}>
                            {formatTimestamp(entry.timestamp)}
                          </time>
                          <div className="admin-log-row__main">
                            <span className={`admin-log-badge is-${entry.level}`}>
                              {levelLabels[entry.level]}
                            </span>
                            <span className="admin-log-source">
                              {sourceLabels[entry.source]}
                            </span>
                            {parsedHTTP ? (
                              <>
                                {parsedHTTP.requestId && (
                                  <span
                                    className="admin-log-pill is-request"
                                    title={`请求 ID：${parsedHTTP.requestId}`}
                                  >
                                    <span className="admin-log-pill__value">{parsedHTTP.requestId}</span>
                                  </span>
                                )}
                                <span
                                  className={`admin-log-badge is-status-${Math.floor(parsedHTTP.status / 100)}`}
                                >
                                  {parsedHTTP.status}
                                </span>
                                <span className="admin-log-pill">
                                  {parsedHTTP.elapsed}
                                </span>
                                <span className="admin-log-pill">
                                  {parsedHTTP.remote}
                                </span>
                                <span className="admin-log-badge is-method">
                                  {parsedHTTP.method}
                                </span>
                                <span
                                  className="admin-log-path"
                                  title={parsedHTTP.path}
                                >
                                  {parsedHTTP.path}
                                </span>
                                <span className="admin-log-message is-muted">
                                  {formatByteCount(parsedHTTP.bytes)}
                                </span>
                              </>
                            ) : (
                              <>
                                {contextKeys.some((key) => entry[key]) && (
                                  <span className="admin-log-context">{contextKeys.filter((key) => entry[key]).map((key) => `${key}=${entry[key]}`).join(" ")}</span>
                                )}
                                <span className="admin-log-message">{entry.message}{entry.error && `: ${entry.error}`}</span>
                                {entry.stack && <details className="admin-log-stack"><summary>错误堆栈</summary><pre>{entry.stack}</pre></details>}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {(viewingHistory || (!followTail && entries.length > 0)) && (
            <button
              type="button"
              className="admin-log-jump-latest"
              onClick={() => { if (viewingHistory) void reload(); else enableFollowTail(); }}
            >
              <ChevronDown size={15} />
              回到最新日志
            </button>
          )}
        </div>

    </section>
  );

  return (
    <>
      <div className="admin-page admin-logs-page">
        <div
          ref={inlineLogViewerSlotRef}
          className="admin-log-viewer-slot"
        />
        {logViewerHost ? createPortal(logViewer, logViewerHost) : logViewer}
      </div>

      <ConfirmModal
        open={clearConfirmOpen}
        title="清空日志"
        message="确定要清空后台文件日志吗？"
        confirmText="确认"
        danger
        hideIcon
        modalClassName="admin-modal--logs-clear"
        loading={clearing}
        onCancel={() => {
          if (!clearing) setClearConfirmOpen(false);
        }}
        onConfirm={() => void clearRuntimeLogs()}
      />
    </>
  );
}
