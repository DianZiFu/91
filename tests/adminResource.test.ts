import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, create } from "react-test-renderer";
import * as api from "../src/admin/api";
import { useAdminResource } from "../src/admin/useAdminResource";
import { TelegramStatusProvider, useTelegramStatus } from "../src/admin/telegram/TelegramStatusProvider";
import { applyTelegramEnabled, getTelegramAvailability } from "../src/admin/telegram/availability";
import { StorageSummary } from "../src/admin/drive/StorageSummary";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function browser(t: TestContext) {
  class TestDocument extends EventTarget { hidden = false; }
  const document = new TestDocument();
  const window = new EventTarget();
  const originals = ["document", "window"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  let renderer: ReturnType<typeof create> | undefined;
  t.after(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    document, window,
    get root() { return renderer!.root; },
    render: async (element: ReactElement) => {
      await act(async () => {
        if (renderer) renderer.update(element); else renderer = create(element);
      });
    },
    tick: async (milliseconds: number) => { await act(async () => t.mock.timers.tick(milliseconds)); },
  };
}

test("independent resources publish without waiting for a slow or failed sibling", async (t) => {
  const env = browser(t);
  const slow = deferred<number>();
  const ready = async () => 12;
  const pending = () => slow.promise;
  const failed = async () => { throw new Error("Transfer unavailable"); };
  let values!: ReturnType<typeof useAdminResource<number>>[];
  function Probe() {
    values = [
      useAdminResource(ready, { active: true, intervalMs: 2000, initialData: 0 }),
      useAdminResource(pending, { active: true, intervalMs: 2000, initialData: 0 }),
      useAdminResource(failed, { active: true, intervalMs: 2000, initialData: 0 }),
    ];
    return null;
  }
  await env.render(createElement(Probe));
  assert.equal(values[0].data, 12);
  assert.equal(values[0].loading, false);
  assert.equal(values[1].loading, true);
  assert.equal(values[2].error, "Transfer unavailable");
  await act(async () => slow.resolve(7));
  assert.equal(values[1].data, 7);
});

test("storage summary keeps its shell and value slots when the drive list settles first", async (t) => {
  const env = browser(t);
  const pendingStorage = deferred<api.AdminDriveStorage>();
  const loadDrives = async () => [];
  const loadStorage = () => pendingStorage.promise;
  let drives!: ReturnType<typeof useAdminResource<never[]>>;
  let storage!: ReturnType<typeof useAdminResource<api.AdminDriveStorage | null>>;
  function Probe() {
    drives = useAdminResource(loadDrives, { active: true, intervalMs: null, initialData: [] });
    storage = useAdminResource(loadStorage, { active: true, intervalMs: null, initialData: null });
    return createElement(StorageSummary, { storage: storage.data, loading: storage.loading });
  }
  await env.render(createElement(Probe));
  const shell = env.root.findByType("section");
  const values = () => env.root.findAllByType("strong").map((node) => node.children.join(""));
  assert.equal(drives.loading, false);
  assert.equal(storage.loading, true);
  assert.equal(shell.props["aria-busy"], true);
  assert.deepEqual(values(), Array(4).fill("\u00a0"));
  await act(async () => pendingStorage.reject(new Error("Storage unavailable")));
  assert.equal(env.root.findByType("section"), shell);
  assert.equal(shell.props["aria-busy"], undefined);
  assert.deepEqual(values(), Array(4).fill("\u00a0"));
});

test("storage summary retains its values and shell during refresh and after a failed read", async (t) => {
  const env = browser(t);
  let read = deferred<api.AdminDriveStorage>();
  const load = () => read.promise;
  let storage!: ReturnType<typeof useAdminResource<api.AdminDriveStorage | null>>;
  function Probe() {
    storage = useAdminResource(load, { active: true, intervalMs: null, initialData: null });
    return createElement(StorageSummary, { storage: storage.data, loading: storage.loading });
  }
  await env.render(createElement(Probe));
  const shell = env.root.findByType("section");
  const values = () => env.root.findAllByType("strong").map((node) => node.children.join(""));
  await act(async () => read.resolve({ thumbnailBytes: 1024, teaserBytes: 2048, totalBytes: 3072, availableBytes: 4096, capacityBytes: 8192, drives: {} }));
  assert.equal(env.root.findByType("section"), shell);
  assert.deepEqual(values(), ["1 KB", "2 KB", "3 KB", "4 KB"]);
  read = deferred<api.AdminDriveStorage>();
  await act(async () => { void storage.refresh(); });
  assert.equal(storage.refreshing, true);
  assert.equal(storage.loading, false);
  assert.deepEqual(values(), ["1 KB", "2 KB", "3 KB", "4 KB"]);
  await act(async () => read.reject(new Error("Storage unavailable")));
  assert.equal(env.root.findByType("section"), shell);
  assert.equal(storage.error, "Storage unavailable");
  assert.deepEqual(values(), ["1 KB", "2 KB", "3 KB", "4 KB"]);
});

test("polling waits for a slow read and repeated refreshes merge into one follow-up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const signals: AbortSignal[] = [];
  const load = (signal: AbortSignal) => { signals.push(signal); const read = deferred<number>(); reads.push(read); return read.promise; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: 1000, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  await env.tick(3000);
  assert.equal(reads.length, 1);
  assert.equal(signals[0].aborted, false);
  let refreshed!: Promise<void>;
  await act(async () => {
    refreshed = value.refresh();
    for (let i = 0; i < 20; i++) void value.refresh();
    reads[0].resolve(1);
  });
  assert.equal(value.data, 1);
  assert.equal(reads.length, 2);
  await act(async () => { reads[1].resolve(2); await refreshed; });
  assert.equal(value.data, 2);
  await env.tick(999);
  assert.equal(reads.length, 2);
  await env.tick(1);
  assert.equal(reads.length, 3);
});

test("inactive routes and hidden documents cancel reads and ignore their late responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const signals: AbortSignal[] = [];
  const load = (signal: AbortSignal) => { signals.push(signal); const read = deferred<number>(); reads.push(read); return read.promise; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe({ active }: { active: boolean }) { value = useAdminResource(load, { active, intervalMs: 1000, initialData: 0 }); return null; }
  await env.render(createElement(Probe, { active: true }));
  await env.render(createElement(Probe, { active: false }));
  assert.equal(signals[0].aborted, true);
  await env.tick(60_000);
  await value.refresh();
  assert.equal(reads.length, 1);
  await env.render(createElement(Probe, { active: true }));
  assert.equal(reads.length, 2);
  await act(async () => { reads[1].resolve(2); reads[0].resolve(1); });
  assert.equal(value.data, 2);
  await act(async () => { env.document.hidden = true; env.document.dispatchEvent(new Event("visibilitychange")); });
  await env.tick(60_000);
  assert.equal(reads.length, 2);
  await act(async () => { env.document.hidden = false; env.document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal(reads.length, 3);
  assert.equal(value.data, 2);
});

test("failures back off while preserving data and network recovery refreshes immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  let calls = 0;
  let healthy = true;
  const load = async () => { calls++; if (!healthy) throw new Error("offline"); return calls; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: 1000, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  healthy = false;
  await env.tick(1000);
  assert.equal(value.error, "offline");
  assert.equal(value.data, 1);
  await env.tick(1999);
  assert.equal(calls, 2);
  await env.tick(1);
  assert.equal(calls, 3);
  await env.tick(3999);
  assert.equal(calls, 3);
  healthy = true;
  await act(async () => env.window.dispatchEvent(new Event("online")));
  assert.equal(calls, 4);
  assert.equal(value.error, "");
  await env.tick(1000);
  assert.equal(calls, 5);
});

test("a stalled loader times out and releases the resource for its next retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  let calls = 0;
  let firstSignal!: AbortSignal;
  const load = (signal: AbortSignal) => {
    calls++;
    if (calls === 1) { firstSignal = signal; return new Promise<number>(() => undefined); }
    return Promise.resolve(8);
  };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: 1000, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  await env.tick(10_000);
  assert.equal(firstSignal.aborted, true);
  assert.match(value.error, /超时/);
  assert.equal(value.loading, false);
  await env.tick(2000);
  assert.equal(calls, 2);
  assert.equal(value.data, 8);
  assert.equal(value.error, "");
});

test("changing a task's polling interval keeps its healthy in-flight read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  const first = deferred<number>();
  let calls = 0;
  let firstSignal!: AbortSignal;
  const load = (signal: AbortSignal) => { calls++; if (calls === 1) { firstSignal = signal; return first.promise; } return Promise.resolve(calls); };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe({ intervalMs }: { intervalMs: number }) { value = useAdminResource(load, { active: true, intervalMs, initialData: 0 }); return null; }
  await env.render(createElement(Probe, { intervalMs: 2000 }));
  await env.render(createElement(Probe, { intervalMs: 500 }));
  await env.tick(3000);
  assert.equal(firstSignal.aborted, false);
  assert.equal(calls, 1);
  await act(async () => first.resolve(1));
  assert.equal(value.data, 1);
  await env.tick(500);
  assert.equal(calls, 2);
});

test("local mutation acknowledgements cancel older reads without postponing the next refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const signals: AbortSignal[] = [];
  const load = (signal: AbortSignal) => { signals.push(signal); const read = deferred<number>(); reads.push(read); return read.promise; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: 1000, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  await act(async () => reads[0].resolve(1));
  await env.tick(1000);
  assert.equal(reads.length, 2);
  await act(async () => { value.setData(9); void value.refresh(); });
  assert.equal(signals[1].aborted, true);
  assert.equal(reads.length, 3);
  await act(async () => reads[1].resolve(2));
  assert.equal(value.data, 9);
  await env.tick(3000);
  assert.equal(reads.length, 3);
  await act(async () => reads[2].resolve(10));
  assert.equal(value.data, 10);
  await env.tick(1000);
  assert.equal(reads.length, 4);
});

test("crawler and backup list clients forward cancellation to fetch", async (t) => {
  const controller = new AbortController();
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    paths.push(input);
    assert.equal(init.signal, controller.signal);
    return Response.json([]);
  });
  await Promise.all([api.listCrawlers(controller.signal), api.listBackups(controller.signal),
    api.listBackupTransfers(controller.signal), api.listBackupReceiveTransfers(controller.signal)]);
  assert.deepEqual(paths.sort(), ["/admin/api/backup-receives", "/admin/api/backup-transfers", "/admin/api/backups", "/admin/api/crawlers"]);
});

test("query and on-demand clients forward cancellation and retain their query parameters", async (t) => {
  const controller = new AbortController();
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    paths.push(input);
    assert.equal(init.signal, controller.signal);
    return Response.json(input.startsWith("/admin/api/videos?") || input.startsWith("/admin/api/blacklist?")
      ? { items: [], total: 0, page: 2, size: 10 } : []);
  });
  await Promise.all([
    api.listVideos({ page: 2, size: 10, keyword: "test" }, controller.signal),
    api.listBlacklist({ page: 2, size: 10, keyword: "test" }, controller.signal),
    api.listTags(controller.signal), api.listUsers(controller.signal), api.listBannedIPs(controller.signal),
    api.getBlacklistSourceDeleteStatus(controller.signal), api.listTelegramImports(32, controller.signal),
  ]);
  assert.equal(paths.length, 7);
  assert.ok(paths.includes("/admin/api/videos?page=2&size=10&keyword=test"));
  assert.ok(paths.includes("/admin/api/blacklist?page=2&size=10&keyword=test"));
});

test("an explicit query key keeps inline loaders stable across renders", async (t) => {
  const env = browser(t);
  let calls = 0;
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe({ label }: { label: string }) {
    value = useAdminResource(async () => { calls++; return 7; }, { queryKey: "fixed", active: true, intervalMs: null, initialData: 0 });
    return createElement("span", null, label);
  }
  await env.render(createElement(Probe, { label: "first" }));
  await env.render(createElement(Probe, { label: "second" }));
  assert.equal(calls, 1);
  assert.equal(value.data, 7);
});

test("A to B to A creates a fresh query and ignores both old success and old failure", async (t) => {
  const env = browser(t);
  const reads: { key: string; read: ReturnType<typeof deferred<number>>; signal: AbortSignal }[] = [];
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe({ queryKey }: { queryKey: string }) {
    value = useAdminResource((signal) => {
      const read = deferred<number>(); reads.push({ key: queryKey, read, signal }); return read.promise;
    }, { queryKey, active: true, intervalMs: null, initialData: 0 });
    return null;
  }
  await env.render(createElement(Probe, { queryKey: "A" }));
  await env.render(createElement(Probe, { queryKey: "B" }));
  await env.render(createElement(Probe, { queryKey: "A" }));
  assert.deepEqual(reads.map((entry) => entry.key), ["A", "B", "A"]);
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(value.ready, false);
  await act(async () => {
    reads[0].read.resolve(1);
    reads[1].read.reject(new api.APIResponseError(404, "Old query missing"));
  });
  assert.equal(value.loading, true);
  assert.equal(value.error, "");
  await act(async () => reads[2].read.resolve(3));
  assert.equal(value.data, 3);
  assert.equal(value.loading, false);
});

test("invalidating after a mutation discards late errors and keeps the new refresh active", async (t) => {
  const env = browser(t);
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const load = () => { const read = deferred<number>(); reads.push(read); return read.promise; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: null, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  await act(async () => reads[0].resolve(1));
  await act(async () => { void value.refresh(); });
  assert.equal(value.refreshing, true);
  await act(async () => { void value.invalidate(); reads[1].reject(new api.UnauthorizedError()); });
  assert.equal(reads.length, 3);
  assert.equal(value.data, 1);
  assert.equal(value.refreshing, true);
  assert.equal(value.unauthorized, false);
  await act(async () => reads[2].resolve(9));
  assert.equal(value.data, 9);
  assert.equal(value.refreshing, false);
});

test("on-demand resources retry server failures and stop polling after recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  let calls = 0;
  const load = async () => { if (++calls === 1) throw new api.APIResponseError(503, "Unavailable"); return 8; };
  let value!: ReturnType<typeof useAdminResource<number>>;
  function Probe() { value = useAdminResource(load, { active: true, intervalMs: null, initialData: 0 }); return null; }
  await env.render(createElement(Probe));
  assert.equal(value.failure instanceof api.APIResponseError, true);
  await env.tick(2000);
  assert.equal(value.data, 8);
  await env.tick(60_000);
  assert.equal(calls, 2);
  await act(async () => env.window.dispatchEvent(new Event("focus")));
  assert.equal(calls, 3);
});

test("permission failures remain resource errors while unauthorized reads stop and notify auth", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = browser(t);
  let unauthorized = 0;
  let calls = 0;
  let permission!: ReturnType<typeof useAdminResource<number>>;
  let session!: ReturnType<typeof useAdminResource<number>>;
  const forbidden = async () => { calls++; throw new api.APIResponseError(403, "Forbidden"); };
  const expired = async () => { calls++; throw new api.UnauthorizedError(); };
  const onUnauthorized = () => { unauthorized++; };
  function Probe() {
    permission = useAdminResource(forbidden, { active: true, intervalMs: 1000, initialData: 0, onUnauthorized });
    session = useAdminResource(expired, { active: true, intervalMs: 1000, initialData: 0, onUnauthorized });
    return null;
  }
  await env.render(createElement(Probe));
  assert.equal(permission.unauthorized, false);
  assert.equal(permission.error, "Forbidden");
  assert.equal(session.unauthorized, true);
  assert.equal(unauthorized, 1);
  await env.tick(60_000);
  assert.equal(calls, 2);
});

function telegramStatus(enabled: boolean): api.TelegramStatus {
  return { enabled, connection: { enabled, state: "connected", botId: "1", username: "example_bot", error: "", lastPoll: "", lastMessage: "",
    cacheAvailableBytes: 0, notificationFailures: 0, config: { enabled, apiBaseUrl: "", allowedUserIds: [], siteBaseUrl: "",
      maxFileSizeBytes: 0, maxPendingJobs: 0, fetchTimeoutSeconds: 0, uploadDriveId: "", uploadDirectory: "" } } };
}

test("Telegram navigation and workspace share status and saved settings supersede old reads", async (t) => {
  const env = browser(t);
  const reads: ReturnType<typeof deferred<Response>>[] = [];
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", (_input: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal); const read = deferred<Response>(); reads.push(read); return read.promise;
  });
  let navigation!: ReturnType<typeof useTelegramStatus>;
  let workspace!: ReturnType<typeof useTelegramStatus>;
  function Navigation() { navigation = useTelegramStatus(); return null; }
  function Workspace() { workspace = useTelegramStatus(); return null; }
  await env.render(createElement(TelegramStatusProvider, { workspaceActive: true }, createElement(Navigation), createElement(Workspace)));
  assert.equal(reads.length, 1);
  await act(async () => reads[0].resolve(Response.json(telegramStatus(false))));
  assert.equal(navigation.data, workspace.data);
  assert.equal(getTelegramAvailability().enabled, false);
  await act(async () => { void workspace.refresh(); });
  await act(async () => applyTelegramEnabled(true));
  assert.equal(signals[1].aborted, true);
  assert.equal(reads.length, 3);
  await act(async () => reads[1].resolve(Response.json(telegramStatus(false))));
  assert.equal(navigation.data?.enabled, true);
  assert.equal(getTelegramAvailability().enabled, true);
  await act(async () => reads[2].resolve(Response.json(telegramStatus(true))));
  assert.equal(workspace.data?.enabled, true);
});
