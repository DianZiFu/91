import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADMIN_LOG_REQUEST_TIMEOUT_MS,
  type AdminLogEntry,
  clearLogs,
  downloadLogs,
  logQueryParams,
  listLogs,
} from "../src/admin/api.ts";
import {
  filterRuntimeLogEntries,
  parseHTTPAccessLog,
  structuredHTTPAccessLog,
} from "../src/admin/LogsPage.tsx";
import {
  LOG_INITIAL_VISIBLE_COUNT,
  LOG_LOAD_MORE_COUNT,
  LOG_LOAD_MORE_THRESHOLD_PX,
  nextVisibleLogCount,
  selectVisibleLogEntries,
} from "../src/admin/useLogScroller.ts";
import {
  LOG_BUFFER_LIMIT,
  LOG_FETCH_BATCH_LIMIT,
  LOG_REFRESH_INTERVAL_MS,
  logRefreshRetryDelay,
  mergeRuntimeLogEntries,
  mergeRuntimeLogSnapshot,
} from "../src/admin/useRuntimeLogs.ts";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(
  new URL("../src/admin/AdminLayout.tsx", import.meta.url),
  "utf8"
);
const logsPageSource = readFileSync(
  new URL("../src/admin/LogsPage.tsx", import.meta.url),
  "utf8"
);
const runtimeLogsSource = readFileSync(
  new URL("../src/admin/useRuntimeLogs.ts", import.meta.url),
  "utf8"
);
const logScrollerSource = readFileSync(
  new URL("../src/admin/useLogScroller.ts", import.meta.url),
  "utf8"
);
const adminCss = readFileSync(
  new URL("../src/styles/admin.css", import.meta.url),
  "utf8"
);

test("admin log viewer is reachable from the authenticated admin layout", () => {
  assert.match(appSource, /path="logs"[\s\S]*?<LogsPage \/>/);
  assert.match(layoutSource, /to="\/admin\/logs"[\s\S]*?<ScrollText size=\{15\} \/>[\s\S]*?日志查看/);
  assert.match(
    logsPageSource,
    /useRuntimeLogs\(\{ autoRefresh: autoRefresh && routeActive, filters \}\)/
  );
  assert.match(runtimeLogsSource, /LOG_REFRESH_INTERVAL_MS = 3000/);
  assert.doesNotMatch(runtimeLogsSource, /source: source \|\| undefined/);
  assert.doesNotMatch(runtimeLogsSource, /level: level \|\| undefined/);
  assert.doesNotMatch(runtimeLogsSource, /method: method \|\| undefined/);
  assert.match(logsPageSource, /useDeferredValue\(search\.trim\(\)\)/);
  assert.match(logsPageSource, /filterRuntimeLogEntries\(bufferedEntries/);
  assert.match(runtimeLogsSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(runtimeLogsSource, /window\.setTimeout\(\(\) => void tick\(\), delay\)/);
  assert.doesNotMatch(runtimeLogsSource, /setInterval\(/);
  assert.match(runtimeLogsSource, /showProgress: false/);
  assert.match(runtimeLogsSource, /LOG_FETCH_BATCH_LIMIT = 1000/);
  assert.match(runtimeLogsSource, /LOG_BUFFER_LIMIT = 10000/);
  assert.doesNotMatch(runtimeLogsSource, /LOG_DISPLAY_LIMIT/);
  assert.doesNotMatch(runtimeLogsSource, /limit: LOG_BUFFER_LIMIT/);
  assert.match(runtimeLogsSource, /\.\.\.filters,\s*limit: LOG_FETCH_BATCH_LIMIT/);
  assert.match(
    runtimeLogsSource,
    /if \(next\.reset\) \{[\s\S]*?cursor = next\.nextCursor;[\s\S]*?break;/
  );
  assert.doesNotMatch(runtimeLogsSource, /const replacement = await api\.listLogs/);
  assert.match(
    logsPageSource,
    /filterRuntimeLogEntries\(bufferedEntries[\s\S]*?useLogScroller\(\{[\s\S]*?entries: matchingEntries/
  );
  assert.match(
    logsPageSource,
    /向上滚动加载更多[\s\S]*?已载入 \{entries\.length\} 行[\s\S]*?已隐藏 \{hiddenEntryCount\} 行/
  );
  assert.doesNotMatch(logsPageSource, /浏览器已缓存|admin-log-footer/);
  assert.match(logScrollerSource, /LOG_INITIAL_VISIBLE_COUNT = 100/);
  assert.match(logScrollerSource, /LOG_LOAD_MORE_COUNT = 200/);
  assert.match(logScrollerSource, /LOG_LOAD_MORE_THRESHOLD_PX = 72/);
  assert.match(
    logScrollerSource,
    /const addedHeight = viewport\.scrollHeight - pending\.scrollHeight;\s*viewport\.scrollTop = pending\.scrollTop \+ addedHeight;/
  );
  assert.match(
    logScrollerSource,
    /viewport\.scrollTop <= LOG_LOAD_MORE_THRESHOLD_PX[\s\S]*?revealOlderEntries\(\)/
  );
  assert.match(
    logScrollerSource,
    /prepareViewportTransition[\s\S]*?\[data-log-entry-id\][\s\S]*?pendingViewportTransitionRef\.current = snapshot/
  );
  assert.match(
    logScrollerSource,
    /pendingViewportTransitionRef\.current[\s\S]*?anchor\.getBoundingClientRect\(\)\.top - viewportContentTop\(viewport\)[\s\S]*?\}, \[fullscreen\]\)/
  );
  assert.doesNotMatch(logsPageSource, /reloadKey|setReloadKey/);
  assert.match(
    logsPageSource,
    /const \[filtersExpanded, setFiltersExpanded\] = useState\(false\)/
  );
  assert.doesNotMatch(logsPageSource, /!fullscreenActive && filtersExpanded &&/);
  assert.match(
    logsPageSource,
    /!fullscreenActive && \(\s*<div\s+id="admin-log-structured-filters"\s+className=\{`admin-log-filter-panel\$\{filtersExpanded \? " is-expanded" : ""\}`\}/
  );
  assert.match(logsPageSource, /admin\.logs\.autoRefresh/);
  assert.match(logsPageSource, /role="log"/);
  assert.match(
    logsPageSource,
    /className="admin-log-loading" role="status">\s*正在加载日志/
  );
  assert.doesNotMatch(logsPageSource, /<AdminLoading \/>/);
  assert.match(logsPageSource, /显示原始日志/);
  assert.match(logsPageSource, /info: "INFO"/);
  assert.match(logsPageSource, /warning: "WARN"/);
  assert.match(logsPageSource, /error: "ERROR"/);
  assert.equal((logsPageSource.match(/label: "ALL"/g) ?? []).length, 3);
  assert.match(logsPageSource, /\{ value: "http", label: "访问" \}/);
  assert.doesNotMatch(logsPageSource, /HTTP 访问/);
  assert.match(
    logsPageSource,
    /admin-log-filter-panel__top[\s\S]*?<span className="admin-log-filter-label">来源<\/span>[\s\S]*?admin-log-clear-filters/
  );
  assert.match(
    adminCss,
    /\.admin-log-filter-panel__top\s*\{[^}]*display:\s*flex[^}]*align-items:\s*flex-start/s
  );
  assert.match(
    adminCss,
    /\.admin-btn\.admin-log-filter-toggle\s*\{[^}]*display:\s*none[^}]*min-height:\s*40px/s
  );
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-btn\.admin-log-filter-toggle\s*\{[^}]*display:\s*inline-flex[^}]*\}[\s\S]*?\.admin-log-filter-panel\s*\{[^}]*display:\s*none[^}]*\}[\s\S]*?\.admin-log-filter-panel\.is-expanded\s*\{[^}]*display:\s*flex/s
  );
  assert.match(
    adminCss,
    /\.admin-log-clear-filters\s*\{[^}]*margin-left:\s*auto[^}]*border:\s*1px solid var\(--border-default\)[^}]*border-radius:\s*var\(--radius-xs\)[^}]*color:\s*var\(--text-strong\)/s
  );
  assert.match(
    adminCss,
    /\.admin-log-filter-chip\s*\{[^}]*min-height:\s*24px[^}]*padding:\s*2px 8px[^}]*background:\s*transparent[^}]*font-size:\s*11px/s
  );
  assert.match(
    adminCss,
    /\.admin-log-filter-chip\.is-active\s*\{[^}]*border-color:\s*color-mix\(in srgb, var\(--text-strong\) 45%, transparent\)[^}]*background:\s*transparent[^}]*color:\s*var\(--text-strong\)/s
  );
  assert.match(logsPageSource, /下载日志/);
  assert.match(
    logsPageSource,
    /刷新日志[\s\S]*?下载日志[\s\S]*?清空日志[\s\S]*?全屏查看/
  );
  assert.match(logsPageSource, /api\.clearLogs\(\)/);
  assert.match(
    logsPageSource,
    /<ConfirmModal[\s\S]*?title="清空日志"[\s\S]*?confirmText="确认"[\s\S]*?danger[\s\S]*?hideIcon/
  );
  assert.doesNotMatch(logsPageSource, /window\.confirm\(/);
  assert.doesNotMatch(logsPageSource, /日志文件 .*服务重启后仍会保留/);
  assert.match(logsPageSource, /全屏查看/);
  assert.match(logsPageSource, /createPortal\(logViewer, logViewerHost\)/);
  assert.match(
    logsPageSource,
    /const target = fullscreenActive \? document\.body : inlineLogViewerSlotRef\.current;[\s\S]*?target\.appendChild\(logViewerHost\)/
  );
  assert.match(logsPageSource, /data-log-entry-id=\{entry\.id\}/);
  assert.match(logsPageSource, /if \(shell\) shell\.inert = true/);
  assert.match(logsPageSource, /!document\.querySelector\("\.admin-modal-backdrop"\)/);
  assert.match(logsPageSource, /role=\{fullscreenActive \? "dialog" : undefined\}/);
  assert.match(logsPageSource, /parseHTTPAccessLog\(entry\.message\)/);
  assert.match(
    logsPageSource,
    /copyTextToClipboard\(formatRawLine\(entry\)\)/
  );
  assert.doesNotMatch(logsPageSource, /navigator\.clipboard\.writeText/);
  assert.match(
    adminCss,
    /\.admin-log-panel__viewport\s*\{[^}]*overflow:\s*auto[^}]*scrollbar-gutter:\s*stable/s
  );
  assert.match(
    adminCss,
    /\.admin-log-load-more\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*justify-content:\s*space-between/s
  );
  assert.match(
    adminCss,
    /\.admin-page-content\s*\{[^}]*display:\s*flex[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*flex-direction:\s*column/s
  );
  assert.match(
    adminCss,
    /\.admin-logs-page\s*\{[^}]*flex:\s*1 1 auto[^}]*height:\s*auto[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s
  );
  assert.match(
    adminCss,
    /\.admin-log-panel\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*height:\s*auto[^}]*max-height:\s*none[^}]*resize:\s*none/s
  );
  assert.match(
    adminCss,
    /\.admin-log-loading,\s*\.admin-log-empty\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*min-height:\s*100%[^}]*place-items:\s*center/s
  );
  assert.match(
    adminCss,
    /\.admin-log-card\.is-fullscreen\s*\{[^}]*z-index:\s*calc\(var\(--z-modal\) - 1\)/s
  );
  assert.match(
    adminCss,
    /html\.admin-logs-fullscreen-active,[\s\S]*?overscroll-behavior:\s*none/
  );
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-logs-page\s*\{[^}]*height:\s*auto[^}]*min-height:\s*0[^}]*overflow:\s*visible/s
  );
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-log-panel\s*\{[^}]*flex:\s*0 0 auto[^}]*min-height:\s*360px[^}]*height:\s*420px[^}]*max-height:\s*480px/s
  );
  assert.doesNotMatch(adminCss, /\.admin-log-panel\s*\{[^}]*68dvh/s);
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-log-card\.is-fullscreen \.admin-log-panel\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*height:\s*auto/s
  );
  assert.match(adminCss, /@media \(max-width: 768px\)[\s\S]*?\.admin-log-row\s*\{/);
});

test("log initial queries fetch one batch while retaining a larger polling buffer", () => {
  assert.ok(LOG_FETCH_BATCH_LIMIT < LOG_BUFFER_LIMIT);
  assert.match(
    runtimeLogsSource,
    /const loadTail = useCallback\([\s\S]*?api\.listLogs\(\s*\{\s*\.\.\.filters,\s*limit: LOG_FETCH_BATCH_LIMIT/
  );
  assert.doesNotMatch(runtimeLogsSource, /limit: LOG_BUFFER_LIMIT/);
  assert.match(runtimeLogsSource, /before, limit: LOG_FETCH_BATCH_LIMIT/);
});

test("log queries distinguish missing current results from refreshing a snapshot", () => {
  assert.doesNotMatch(runtimeLogsSource, /hasLoadedRef/);
  assert.match(
    runtimeLogsSource,
    /const hasSnapshot = snapshotRef\.current !== null;\s*setLoading\(!hasSnapshot\);\s*setRefreshing\(showProgress && hasSnapshot\)/
  );
  assert.match(
    runtimeLogsSource,
    /snapshotRef\.current = null;\s*setSnapshot\(null\);\s*setRequestedFilters\(filters\);\s*void loadTail/
  );
  assert.match(runtimeLogsSource, /const filtersChanged = requestedFilters !== filters/);
  assert.match(runtimeLogsSource, /snapshot: filtersChanged \? null : snapshot/);
  assert.match(runtimeLogsSource, /loading: filtersChanged \|\| loading/);
  assert.match(runtimeLogsSource, /error: filtersChanged \? "" : error/);
});

test("log empty states wait for debounced searches and foreground requests", () => {
  assert.match(
    logsPageSource,
    /const searchPending = search\.trim\(\) !== deferredSearch \|\| deferredSearch !== serverSearch/
  );
  assert.match(
    logsPageSource,
    /const logsBusy = loading \|\| refreshing \|\| loadingOlder \|\| searchPending/
  );
  assert.match(logsPageSource, /aria-busy=\{logsBusy\}/);
  assert.match(
    logsPageSource,
    /logsBusy && entries\.length === 0 \? \([\s\S]*?正在加载日志[\s\S]*?\) : entries\.length === 0 \? \(\s*!error && \([\s\S]*?className="admin-log-empty"/
  );
  assert.doesNotMatch(logsPageSource, /loading && !snapshot \?/);
});

test("log page omits time-range controls while retaining server-backed filters", () => {
  assert.doesNotMatch(logsPageSource, /datetime-local|logDateTime|setFrom|setTo|\bfrom:|\bto:/);
  assert.doesNotMatch(adminCss, /admin-log-date-range/);
  assert.match(logsPageSource, /source: source \|\| undefined/);
  assert.match(logsPageSource, /level: level \|\| undefined/);
  assert.match(logsPageSource, /method: method \|\| undefined/);
  assert.match(logsPageSource, /query: serverSearch/);
});

test("historical queries and exports use the server filters and complete retained history", async () => {
  const params = logQueryParams({ source: "application", level: "error", query: "drive-1", before: 500, from: "2026-09-09T00:00:00Z", to: "2026-09-09T01:00:00Z" });
  assert.equal(params.get("before"), "500");
  assert.equal(params.get("from"), "2026-09-09T00:00:00Z");
  assert.equal(params.get("q"), "drive-1");
  const originalFetch = globalThis.fetch;
  let requestedURL = "";
  globalThis.fetch = async (input) => {
    requestedURL = String(input);
    return new Response("all retained matching log entries", { headers: { "Content-Type": "text/plain" } });
  };
  try {
    const blob = await downloadLogs({ level: "error", query: "drive-1", cursor: "old-cursor", before: 500 });
    const url = new URL(requestedURL, "http://localhost");
    assert.equal(url.searchParams.get("download"), "1");
    assert.equal(url.searchParams.get("level"), "error");
    assert.equal(url.searchParams.get("q"), "drive-1");
    assert.equal(url.searchParams.has("cursor"), false);
    assert.equal(url.searchParams.has("before"), false);
    assert.equal(await blob.text(), "all retained matching log entries");
  } finally { globalThis.fetch = originalFetch; }
  assert.match(runtimeLogsSource, /before, limit: LOG_FETCH_BATCH_LIMIT/);
  assert.match(logsPageSource, /api\.downloadLogs\(filters, controller\.signal\)/);
  assert.match(logsPageSource, /writeHealth\?\.lastError/);
  assert.match(logsPageSource, /entry\.stack/);
});

test("mobile fullscreen logs keep only the exit fullscreen action", () => {
  assert.match(
    logsPageSource,
    /className="admin-btn admin-log-fullscreen-toggle"[\s\S]*?fullscreenActive \? "退出全屏" : "全屏查看"/
  );
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-log-card\.is-fullscreen \.admin-log-toggles,\s*\.admin-log-card\.is-fullscreen\s+\.admin-log-actions\s+> \.admin-btn:not\(\.admin-log-fullscreen-toggle\),\s*\.admin-log-card\.is-fullscreen \.admin-log-jump-latest\s*\{[^}]*display:\s*none;/s
  );
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-log-card\.is-fullscreen \.admin-log-actions\s*\{[^}]*display:\s*flex;[^}]*width:\s*auto;[^}]*margin-left:\s*auto;/s
  );
});

test("admin log polling bounds its cache and progressively reveals entries", () => {
  const entry = (id: number) => ({
    id,
    timestamp: "2026-08-02T00:00:00Z",
    source: "application" as const,
    level: "info" as const,
    message: `entry-${id}`,
  });

  assert.equal(LOG_REFRESH_INTERVAL_MS, 3000);
  assert.equal(LOG_FETCH_BATCH_LIMIT, 1000);
  assert.equal(LOG_BUFFER_LIMIT, 10000);
  assert.equal(LOG_INITIAL_VISIBLE_COUNT, 100);
  assert.equal(LOG_LOAD_MORE_COUNT, 200);
  assert.equal(LOG_LOAD_MORE_THRESHOLD_PX, 72);
  assert.equal(nextVisibleLogCount(100, 564), 300);
  assert.equal(nextVisibleLogCount(300, 564), 500);
  assert.equal(nextVisibleLogCount(500, 564), 564);
  assert.deepEqual(selectVisibleLogEntries([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(
    mergeRuntimeLogEntries([entry(1), entry(2)], [entry(2), entry(3)], 3).map(
      (item) => item.id
    ),
    [1, 2, 3]
  );
  assert.deepEqual(
    mergeRuntimeLogEntries([entry(1), entry(2)], [entry(3), entry(4)], 3).map(
      (item) => item.id
    ),
    [2, 3, 4]
  );
  const resetSnapshot = mergeRuntimeLogSnapshot(
    {
      entries: [entry(1), entry(2)],
      matched: 2,
      storageBytes: 200,
      maxStorageBytes: 1000,
      nextCursor: "stale-cursor",
    },
    {
      entries: [entry(9)],
      matched: 1,
      storageBytes: 100,
      maxStorageBytes: 1000,
      nextCursor: "fresh-cursor",
      reset: true,
    },
    []
  );
  assert.deepEqual(resetSnapshot.entries.map((item) => item.id), [9]);
  assert.equal(resetSnapshot.nextCursor, "fresh-cursor");
  assert.equal(resetSnapshot.reset, true);
});

test("admin log filters run locally across the loaded buffer", () => {
  const entries: AdminLogEntry[] = [
    {
      id: 1,
      timestamp: "2026-08-02T00:00:00Z",
      source: "application",
      level: "info",
      message: "worker ready",
    },
    {
      id: 2,
      timestamp: "2026-08-02T00:00:01Z",
      source: "http",
      level: "warning",
      method: "POST",
      status: 429,
      path: "/admin/api/videos",
      remote: "203.0.113.7",
      message: "request rate limited",
    },
    {
      id: 3,
      timestamp: "2026-08-02T00:00:02Z",
      source: "http",
      level: "error",
      method: "GET",
      status: 503,
      path: "/api/videos",
      message: "upstream unavailable",
    },
  ];

  const filter = (overrides: Partial<Parameters<typeof filterRuntimeLogEntries>[1]>) =>
    filterRuntimeLogEntries(entries, {
      source: "",
      level: "",
      method: "",
      query: "",
      ...overrides,
    }).map((entry) => entry.id);

  assert.deepEqual(filter({ source: "application" }), [1]);
  assert.deepEqual(filter({ level: "error" }), [3]);
  assert.deepEqual(filter({ method: "POST" }), [2]);
  assert.deepEqual(filter({ query: "203.0.113.7" }), [2]);
  assert.deepEqual(filter({ query: "UPSTREAM" }), [3]);
  assert.deepEqual(filter({ source: "http", level: "warning", method: "POST" }), [2]);
});

test("admin log polling backs off failed requests up to thirty seconds", () => {
  assert.equal(logRefreshRetryDelay(1), 3000);
  assert.equal(logRefreshRetryDelay(2), 6000);
  assert.equal(logRefreshRetryDelay(3), 12000);
  assert.equal(logRefreshRetryDelay(4), 24000);
  assert.equal(logRefreshRetryDelay(5), 30000);
  assert.equal(logRefreshRetryDelay(20), 30000);
});

test("admin log API client sends bounded encoded filters", async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedInit = init;
    return new Response(
      JSON.stringify({
        entries: [],
        matched: 0,
        storageBytes: 0,
        maxStorageBytes: 52428800,
        nextCursor: "next-cursor",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await listLogs({
      source: "application",
      level: "error",
      method: "POST",
      query: "任务 失败",
      limit: 250,
      cursor: "cursor-v1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    requestedURL,
    "/admin/api/logs?limit=250&cursor=cursor-v1&source=application&level=error&method=POST&q=%E4%BB%BB%E5%8A%A1+%E5%A4%B1%E8%B4%A5"
  );
  assert.equal(requestedInit?.credentials, "include");
});

test("admin log API client aborts a stalled request with a clear timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) rejectAbort();
      else signal?.addEventListener("abort", rejectAbort, { once: true });
    })) as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler, _delay?: number) =>
    originalSetTimeout(callback, 0)) as typeof setTimeout;

  try {
    assert.equal(ADMIN_LOG_REQUEST_TIMEOUT_MS, 15000);
    await assert.rejects(listLogs(), /日志请求超时，请稍后重试/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("admin log API client clears only the file-backed viewer history", async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await clearLogs();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedURL, "/admin/api/logs");
  assert.equal(requestedInit?.method, "DELETE");
  assert.equal(requestedInit?.credentials, "include");
});

test("request ID pills truncate their text inside the padded capsule", () => {
  assert.match(logsPageSource, /title=\{`请求 ID：\$\{parsedHTTP\.requestId\}`\}/);
  assert.match(logsPageSource, /<span className="admin-log-pill__value">\{parsedHTTP\.requestId\}<\/span>/);
  const pill = /\.admin-log-pill\.is-request\s*\{([^}]+)\}/.exec(adminCss)?.[1];
  assert.ok(pill);
  assert.match(pill, /min-width:\s*0/);
  assert.match(pill, /max-width:\s*min\(180px, 100%\)/);
  assert.doesNotMatch(pill, /overflow:\s*hidden/);
  assert.match(adminCss, /\.admin-log-pill\.is-request \.admin-log-pill__value\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
});

test("HTTP access records are presented as structured log fields", () => {
  assert.deepEqual(
    parseHTTPAccessLog(
      '[a1b2c3d4] "GET http://example.test/videos?page=2 HTTP/1.1" from 127.0.0.1:43210 - 503 1536B in 12.5ms'
    ),
    {
      requestId: "a1b2c3d4",
      method: "GET",
      path: "/videos?page=2",
      remote: "127.0.0.1:43210",
      status: 503,
      bytes: 1536,
      elapsed: "12.5ms",
    }
  );

  assert.equal(parseHTTPAccessLog("ordinary application log"), null);

  assert.deepEqual(
    structuredHTTPAccessLog({
      id: 7,
      timestamp: "2026-08-02T00:00:00Z",
      source: "http",
      level: "warning",
      method: "PATCH",
      status: 429,
      path: "/admin/api/videos/7",
      remote: "10.0.0.2:1234",
      bytes: 24,
      elapsed: "2ms",
      requestId: "request-7",
      message: "the rendered format no longer needs to be parsed",
    }),
    {
      requestId: "request-7",
      method: "PATCH",
      path: "/admin/api/videos/7",
      remote: "10.0.0.2:1234",
      status: 429,
      bytes: 24,
      elapsed: "2ms",
    }
  );
});
