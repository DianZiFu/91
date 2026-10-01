import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement, useState, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
} from "react-router";
import { navigationHistory, observeNavigationHistory } from "../src/lib/navigationHistory";
import { useNativeBackHandler, useNativeBackNavigation } from "../src/lib/useNativeBack";
import { RouteActivityProvider } from "../src/lib/routeActivity";
import { bindPlayerNativeBack } from "../src/lib/playerNativeBack";
import { useShortsNavigation } from "../src/shorts/useShortsNavigation";

const listing = {
  pathname: "/list",
  search: "?tag=drama&sort=latest",
  key: "native-back-list",
};
const firstVideo = { pathname: "/video/a", key: "native-back-a" };
const nextVideo = { pathname: "/video/b", key: "native-back-b" };

async function mount(
  t: TestContext,
  options: {
    android?: boolean;
    supported?: boolean;
    direct?: boolean;
    entries?: { pathname: string; search?: string; key: string; state?: unknown }[];
    children?: ReactNode;
    document?: unknown;
  } = {}
) {
  const watchers: FakeCloseWatcher[] = [];
  class FakeCloseWatcher extends EventTarget {
    destroyed = false;
    constructor() {
      super();
      watchers.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
    closeRequest() {
      // Still dispatch after destroy to check that stale callbacks are detached.
      this.destroyed = true;
      this.dispatchEvent(new Event("close"));
    }
  }

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  if (options.document) {
    Object.defineProperty(globalThis, "document", { configurable: true, value: options.document });
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      navigator: { userAgent: options.android === false ? "Desktop Chrome" : "Android Chrome" },
      CloseWatcher: options.supported === false ? undefined : FakeCloseWatcher,
    },
  });

  const entries = options.entries ?? [listing, firstVideo, nextVideo];
  navigationHistory.record(entries[0].key, "POP");
  if (!options.direct) {
    for (const entry of entries.slice(1)) navigationHistory.record(entry.key, "PUSH");
  }

  let current!: Location;
  let navigate!: NavigateFunction;
  function Probe() {
    current = useLocation();
    navigate = useNavigate();
    useNativeBackNavigation();
    return options.children ?? null;
  }

  const router = createMemoryRouter([{ path: "*", element: createElement(Probe) }], {
    initialEntries: options.direct ? [entries.at(-1)!] : entries,
    initialIndex: options.direct ? 0 : entries.length - 1,
  });
  const stopObserving = observeNavigationHistory(router);
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(RouterProvider, { router }));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    stopObserving();
    router.dispose();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as Record<string, unknown>).window;
    if (options.document) {
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else delete (globalThis as Record<string, unknown>).document;
    }
    navigationHistory.record("native-back-test-cleanup", "POP");
  });

  return {
    watchers,
    activeWatchers: () => watchers.filter(watcher => !watcher.destroyed),
    location: () => current,
    back: async (watcher = watchers.at(-1)!) => {
      await act(async () => watcher.closeRequest());
    },
    go: async (delta: number) => { await act(async () => navigate(delta)); },
    visit: async (path: string) => { await act(async () => navigate(path)); },
    unmount: async () => { await act(async () => renderer.unmount()); },
  };
}

test("native close follows one history step per video and restores the original listing URL", async (t) => {
  const view = await mount(t);
  assert.equal(view.watchers.length, 1);
  await view.back();
  assert.equal(view.location().key, firstVideo.key);
  assert.equal(view.watchers[0].destroyed, true);
  assert.equal(view.watchers.length, 2);
  await view.back();
  assert.equal(view.location().key, listing.key);
  assert.equal(view.location().search, listing.search);
  assert.equal(view.watchers[1].destroyed, true);
  assert.equal(view.watchers.length, 2, "the listing does not intercept app exit");

  await view.go(1);
  assert.equal(view.location().key, firstVideo.key, "native close does not replace or add history");
  assert.equal(view.watchers.length, 3, "revisited videos handle native back again");
  await view.back();
  assert.equal(view.location().key, listing.key);
});

test("desktop Escape, unsupported browsers and direct loads retain ordinary history navigation", async (t) => {
  for (const options of [{ android: false }, { supported: false }, { direct: true }]) {
    await t.test(JSON.stringify(options), async (subtest) => {
      const view = await mount(subtest, options);
      assert.equal(view.watchers.length, 0);
      if (options.direct) {
        assert.equal(navigationHistory.canGoBack(view.location().key), false);
      } else {
        await view.go(-1);
        assert.equal(view.location().key, firstVideo.key);
      }
    });
  }
});

test("duplicate or stale native close events cannot skip pages or navigate after unmount", async (t) => {
  const view = await mount(t);
  const stale = view.watchers[0];
  await act(async () => {
    stale.closeRequest();
    stale.closeRequest();
  });
  assert.equal(view.location().key, firstVideo.key);
  await view.back(stale);
  assert.equal(view.location().key, firstVideo.key);

  const current = view.watchers.at(-1)!;
  await view.visit("/upload");
  assert.equal(current.destroyed, true);
  await view.back(current);
  assert.equal(view.location().pathname, "/upload");

  await view.go(-1);
  const unmounted = view.watchers.at(-1)!;
  await view.unmount();
  assert.equal(unmounted.destroyed, true);
  await view.back(unmounted);
  assert.equal(view.location().key, firstVideo.key);
});

test("all application routes share immediate native history back", async (t) => {
  for (const pathname of ["/", "/list", "/upload", "/admin/drives", "/admin/logs", "/admin/settings", "/login", "/share"]) {
    await t.test(pathname, async (subtest) => {
      const view = await mount(subtest, {
        entries: [listing, { pathname, key: `route-${pathname}` }],
      });
      assert.equal(view.activeWatchers().length, 1);
      await view.back();
      assert.equal(view.location().key, listing.key);
      assert.equal(view.location().search, listing.search);
      assert.equal(view.activeWatchers().length, 0);
    });
  }
});

test("dialogs, menus and web fullscreen close one layer at a time before the page", async (t) => {
  const closed: string[] = [];
  function Surfaces() {
    const [fullscreen, setFullscreen] = useState(true);
    const [menu, setMenu] = useState(true);
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    useNativeBackHandler(fullscreen, () => { closed.push("fullscreen"); setFullscreen(false); }, "fullscreen");
    useNativeBackHandler(menu, () => { closed.push("menu"); setMenu(false); }, "menu");
    useNativeBackHandler(outer, () => { closed.push("outer"); setOuter(false); });
    useNativeBackHandler(inner, () => { closed.push("inner"); setInner(false); });
    return null;
  }
  const view = await mount(t, { children: createElement(Surfaces) });
  for (const layer of ["inner", "outer", "menu", "fullscreen"]) {
    assert.equal(view.activeWatchers().length, 1, "overlays share one browser watcher");
    await view.back();
    assert.equal(closed.at(-1), layer);
    assert.equal(view.location().key, nextVideo.key, "closing a layer cannot also leave the page");
  }
  assert.equal(view.activeWatchers().length, 1);
  await view.back();
  assert.equal(view.location().key, firstVideo.key);
});

test("saving dialogs consume back until they can close and always rearm the watcher", async (t) => {
  let finishSaving!: () => void;
  let requests = 0;
  function SavingDialog() {
    const [saving, setSaving] = useState(true);
    const [open, setOpen] = useState(true);
    finishSaving = () => setSaving(false);
    useNativeBackHandler(open, () => {
      requests++;
      if (!saving) setOpen(false);
    });
    return null;
  }
  const view = await mount(t, { children: createElement(SavingDialog) });
  await view.back();
  await view.back();
  assert.equal(requests, 2);
  assert.equal(view.location().key, nextVideo.key);
  assert.equal(view.activeWatchers().length, 1);
  await act(async () => finishSaving());
  await view.back();
  assert.equal(requests, 3, "the callback reads the latest saving state");
  assert.equal(view.location().key, nextVideo.key);
  await view.back();
  assert.equal(view.location().key, firstVideo.key);
});

test("inactive retained routes cannot close hidden dialogs or intercept native back", async (t) => {
  let hiddenRequests = 0;
  function HiddenDialog() {
    useNativeBackHandler(true, () => { hiddenRequests++; });
    return null;
  }
  const view = await mount(t, {
    children: createElement(RouteActivityProvider, { active: false }, createElement(HiddenDialog)),
  });
  await view.back();
  assert.equal(view.location().key, firstVideo.key);
  assert.equal(hiddenRequests, 0);
});

test("a direct-loaded page can close a dialog and then release native app exit", async (t) => {
  function Dialog() {
    const [open, setOpen] = useState(true);
    useNativeBackHandler(open, () => setOpen(false));
    return null;
  }
  const view = await mount(t, { direct: true, children: createElement(Dialog) });
  assert.equal(view.activeWatchers().length, 1);
  await view.back();
  assert.equal(view.location().key, nextVideo.key);
  assert.equal(view.activeWatchers().length, 0);
});

test("a dialog can decline a request so the actual top dialog handles it", async (t) => {
  const requests: string[] = [];
  function Dialogs() {
    const [open, setOpen] = useState(true);
    useNativeBackHandler(open, () => { requests.push("top"); setOpen(false); });
    useNativeBackHandler(open, () => false);
    return null;
  }
  const view = await mount(t, { children: createElement(Dialogs) });
  await view.back();
  assert.deepEqual(requests, ["top"]);
  assert.equal(view.location().key, nextVideo.key);
});

test("player settings close before web fullscreen, and player cleanup releases both", async (t) => {
  const view = await mount(t);
  const events = new EventTarget();
  let fullscreen = false;
  let settings = false;
  const player = {
    get fullscreenWeb() { return fullscreen; },
    set fullscreenWeb(value: boolean) { fullscreen = value; events.dispatchEvent(new Event("fullscreenWeb")); },
    setting: {
      get show() { return settings; },
      set show(value: boolean) { settings = value; events.dispatchEvent(new Event("setting")); },
    },
    on(name: string, listener: EventListener) { events.addEventListener(name, listener); },
    off(name: string, listener: EventListener) { events.removeEventListener(name, listener); },
  };
  const stop = bindPlayerNativeBack(player as unknown as Parameters<typeof bindPlayerNativeBack>[0]);
  t.after(stop);
  await act(async () => { player.fullscreenWeb = true; player.setting.show = true; });
  assert.equal(view.activeWatchers().length, 1);
  await view.back();
  assert.equal(player.setting.show, false);
  assert.equal(player.fullscreenWeb, true);
  assert.equal(view.location().key, nextVideo.key);
  await view.back();
  assert.equal(player.fullscreenWeb, false);
  assert.equal(view.location().key, nextVideo.key);

  await act(async () => { player.fullscreenWeb = true; player.setting.show = true; stop(); });
  await view.back();
  assert.equal(view.location().key, firstVideo.key, "a disposed player cannot consume back");
});

test("shorts clear-screen history uses the shared watcher without skipping normal playback", async (t) => {
  const doc = Object.assign(new EventTarget(), { documentElement: {}, fullscreenElement: null });
  function Shorts() { useShortsNavigation(); return null; }
  function ActiveShorts() {
    return useLocation().pathname === "/shorts" ? createElement(Shorts) : null;
  }
  const normal = { pathname: "/shorts", key: "shorts-normal", state: { shortsPlayback: "normal" } };
  const clear = { pathname: "/shorts", key: "shorts-clear", state: { shortsPlayback: "clear" } };
  const view = await mount(t, {
    entries: [listing, normal, clear],
    document: doc,
    children: createElement(ActiveShorts),
  });
  assert.equal(view.activeWatchers().length, 1);
  await view.back();
  assert.equal(view.location().key, normal.key);
  assert.equal(view.location().state.shortsPlayback, "normal");
  assert.equal(view.activeWatchers().length, 1);
  await view.back();
  assert.equal(view.location().key, listing.key);
  assert.equal(view.activeWatchers().length, 0);
});

test("shorts entry initialization preserves native back through its prepared home entry", async (t) => {
  const doc = Object.assign(new EventTarget(), { documentElement: {}, fullscreenElement: null });
  function Shorts() { useShortsNavigation(); return null; }
  function ActiveShorts() {
    return useLocation().pathname === "/shorts" ? createElement(Shorts) : null;
  }
  const view = await mount(t, {
    entries: [listing, { pathname: "/shorts", key: "shorts-initial" }],
    document: doc,
    children: createElement(ActiveShorts),
  });
  assert.equal(view.location().state.shortsPlayback, "normal");
  await view.back();
  assert.equal(view.location().pathname, "/");
  assert.equal(view.activeWatchers().length, 1, "the prepared home still has the original listing behind it");
  await view.back();
  assert.equal(view.location().key, listing.key);
});
