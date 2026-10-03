import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

const routeCacheSource = source("admin/AdminRouteCache.tsx");
const pageModulesSource = source("admin/adminPageModules.ts");
const pagePreloadSource = source("admin/adminPagePreload.ts");
const appSource = source("App.tsx");
const layoutSource = source("admin/AdminLayout.tsx");
const modalSource = source("admin/Modal.tsx");
const drivesSource = source("admin/DrivesPage.tsx");
const driveListDataSource = source("admin/drive/useDriveListData.ts");
const driveDetailDataSource = source("admin/drive/useDriveDetailData.ts");
const adminResourceSource = source("admin/useAdminResource.ts");
const crawlersSource = source("admin/CrawlersPage.tsx");
const videosSource = source("admin/VideosPage.tsx");
const tagsSource = source("admin/TagsPage.tsx");
const usersSource = source("admin/UsersPage.tsx");
const backupSource = source("admin/BackupPage.tsx");
const logsSource = source("admin/LogsPage.tsx");
const settingsSource = source("admin/SettingsPage.tsx");
const adminCss = source("styles/admin.css");

test("admin layout retains visited pages behind one bounded route cache", () => {
  assert.match(layoutSource, /<AdminRouteCache \/>/);
  assert.match(routeCacheSource, /ADMIN_PAGE_TITLES\.find/);
  assert.match(routeCacheSource, /cachedRoutesRef\.current\.set\(cacheKey/);
  assert.match(routeCacheSource, /hidden=\{!active\}/);
  assert.match(routeCacheSource, /containerRef\.current\.inert = !active/);
  assert.match(routeCacheSource, /value=\{route\.locationContext\}/);
  assert.match(
    adminCss,
    /\.admin-route-cache-entry\[hidden\]\s*\{[^}]*display:\s*none/s
  );
});

test("retained pages revalidate silently when they become active again", () => {
  assert.match(
    routeCacheSource,
    /if \(active && !previouslyActiveRef\.current\) revalidateRef\.current\(\)/
  );

  for (const pageSource of [
    logsSource,
    settingsSource,
  ]) {
    assert.match(pageSource, /useAdminRouteRevalidation/);
  }

  for (const pageSource of [videosSource, tagsSource, usersSource]) {
    assert.match(pageSource, /useAdminResource/);
    assert.match(pageSource, /active: routeActive/);
  }

  assert.match(crawlersSource, /useAdminResource[\s\S]*?active: routeActive/);
  assert.match(backupSource, /const pollingActive = routeActive && !restoring/);
  assert.match(backupSource, /active: pollingActive/);
  assert.match(adminResourceSource, /document\.addEventListener\("visibilitychange", resume\)/);
  assert.match(
    settingsSource,
    /if \(!dirty\) void load\(true\)/
  );
  assert.match(settingsSource, /if \(silent && dirtyRef\.current\) return/);
});

test("hidden pages suspend recurring and out-of-tree UI work", () => {
  assert.match(drivesSource, /useDriveListData\(routeActive && !selectedDriveId\)/);
  assert.match(driveListDataSource, /queryKey: "drives", active/);
  assert.match(driveDetailDataSource, /if \(!driveId \|\| !routeActive \|\| !visible\) return/);
  assert.match(adminResourceSource, /if \(!options\.active\) return/);
  assert.match(adminResourceSource, /if \(document\.hidden\) resource\.pause\(\)/);
  assert.match(videosSource, /active: routeActive/);
  assert.match(logsSource, /autoRefresh: autoRefresh && routeActive/);
  assert.match(logsSource, /const fullscreenActive = fullscreen && routeActive/);
  assert.match(modalSource, /const visible = open && routeActive/);
  assert.match(modalSource, /if \(!visible\) return null/);
});

test("remaining admin page modules preload sequentially during idle time", () => {
  assert.match(layoutSource, /useAdminPageModulePreload\(location\.pathname\)/);
  assert.match(layoutSource, /preloadRemainingAdminPageModules\(preloadOrigin\)/);
  assert.match(pagePreloadSource, /window\.requestIdleCallback\(task\)/);
  assert.match(pagePreloadSource, /const nextModule = queue\.shift\(\)/);
  assert.match(
    pagePreloadSource,
    /nextModule\.load\(\)\.catch\(\(\) => undefined\)\.finally\(scheduleNext\)/
  );
  assert.match(pagePreloadSource, /activeModule\?\.load\(\) \?\? Promise\.resolve\(\)/);
  assert.match(pageModulesSource, /reusableModuleLoader/);
  assert.match(appSource, /loadDrivesPage\(\)\.then/);
  assert.match(appSource, /loadSettingsPage\(\)\.then/);
  assert.doesNotMatch(layoutSource, /onMouseEnter|onPointerEnter|onFocus=/);
});
