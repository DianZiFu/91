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
    drivesSource,
    crawlersSource,
    videosSource,
    tagsSource,
    usersSource,
    logsSource,
    settingsSource,
  ]) {
    assert.match(pageSource, /useAdminRouteRevalidation/);
  }

  assert.match(backupSource, /if \(!routeActive\) return;[\s\S]*?refresh\(true\)/);
  assert.match(
    settingsSource,
    /if \(!dirty\) void load\(true\)/
  );
  assert.match(settingsSource, /if \(silent && dirtyRef\.current\) return/);
});

test("hidden pages suspend recurring and out-of-tree UI work", () => {
  assert.match(drivesSource, /if \(!routeActive\) return;[\s\S]*?setInterval/);
  assert.match(crawlersSource, /if \(!routeActive\) return;[\s\S]*?setInterval/);
  assert.match(videosSource, /if \(!routeActive \|\| \(trackedRegenCount === 0/);
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
