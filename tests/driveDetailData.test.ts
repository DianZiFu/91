import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../src/admin/api";
import { DriveDetailData, type DriveDetailDependencies } from "../src/admin/drive/driveDetailData";
import { RefreshRequest } from "../src/admin/RefreshRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const generation = (state = "idle", scannedCount = 0): api.DriveGenerationStatus => ({ state, scannedCount, queueLength: 0, addedCount: 0, doneCount: 0, totalCount: 0 });
const config: api.DriveConfig = { id: "a", kind: "quark", name: "A", rootId: "0", status: "ok", hasCredential: true, canUpload: true, skipDirIds: [] };
const data: api.DriveResourceData = {
  config,
  runtime: { scanGenerationStatus: generation() },
  stats: { thumbnailReadyCount: 0, thumbnailPendingCount: 0, thumbnailFailedCount: 0, thumbnailDurationPendingCount: 0, teaserReadyCount: 0, teaserPendingCount: 0, teaserFailedCount: 0, fingerprintReadyCount: 0, fingerprintPendingCount: 0, fingerprintFailedCount: 0 },
  storage: { thumbnailBytes: 0, teaserBytes: 0, totalBytes: 0 },
};
function snapshot(resource: api.DriveResource, revision = 1, payload = data[resource], epoch = "server"): api.DriveSnapshot {
  return { driveId: "a", resource, revision, epoch, updatedAt: "2026-10-02T12:00:00Z", data: payload };
}
function harness(load?: DriveDetailDependencies["load"]) {
  const calls: api.DriveResource[] = [];
  const streams: { snapshot(value: api.DriveSnapshot): void; open(): void; error(): void; closed: boolean }[] = [];
  const view = new DriveDetailData("a", {
    load: (id, resource, signal) => { calls.push(resource); return load ? load(id, resource, signal) : Promise.resolve(snapshot(resource)); },
    subscribe: (_id, receive, open, error) => {
      const stream = { snapshot: receive, open, error, closed: false };
      streams.push(stream);
      return { close: () => { stream.closed = true; } };
    },
  });
  return { view, calls, streams };
}

test("refresh bursts preserve a slow result and merge into one follow-up request", async () => {
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const signals: AbortSignal[] = [];
  const applied: number[] = [];
  const request = new RefreshRequest((signal) => { const read = deferred<number>(); reads.push(read); signals.push(signal); return read.promise; }, (value) => applied.push(value), assert.fail);
  const done = request.refresh();
  for (let i = 0; i < 20; i++) void request.refresh();
  assert.equal(reads.length, 1);
  assert.equal(signals[0].aborted, false);
  reads[0].resolve(1);
  await flush();
  assert.deepEqual(applied, [1]);
  assert.equal(reads.length, 2);
  reads[1].resolve(2);
  await done;
  assert.deepEqual(applied, [1, 2]);
});

test("canceling a refresh ignores its late response and permits a new read immediately", async () => {
  const reads: ReturnType<typeof deferred<number>>[] = [];
  const applied: number[] = [];
  const request = new RefreshRequest(() => { const read = deferred<number>(); reads.push(read); return read.promise; }, (value) => applied.push(value), assert.fail);
  const old = request.refresh();
  request.cancel();
  const current = request.refresh();
  reads[1].resolve(2);
  await current;
  reads[0].resolve(1);
  await old;
  assert.deepEqual(applied, [2]);
});

test("a request timeout releases the flight even if a loader ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: unknown[] = [];
  const request = new RefreshRequest(() => new Promise<number>(() => undefined), assert.fail, (error) => errors.push(error), 100);
  const done = request.refresh();
  t.mock.timers.tick(100);
  await done;
  assert.match(String(errors[0]), /刷新超时/);
  const retry = request.refresh();
  t.mock.timers.tick(100);
  await retry;
  assert.equal(errors.length, 2);
});

test("a failed storage read cannot delay or discard config, task state and counts", async (t) => {
  const storage = deferred<api.DriveSnapshot>();
  const { view } = harness((_id, resource) => resource === "storage" ? storage.promise : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  await flush();
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
  assert.equal(view.getSnapshot().resources.runtime.data?.scanGenerationStatus?.state, "idle");
  assert.ok(view.getSnapshot().resources.stats.data);
  storage.reject(new Error("disk unavailable"));
  await flush();
  assert.equal(view.getSnapshot().resources.storage.error, "disk unavailable");
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
});

test("pushed revisions and mutation acknowledgements cannot be rolled back by an older read", async (t) => {
  const read = deferred<api.DriveSnapshot>();
  const { view, streams } = harness((_id, resource) => resource === "runtime" ? read.promise : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  streams[0].snapshot(snapshot("runtime", 10, { scanGenerationStatus: generation("scanning", 9) }));
  read.resolve(snapshot("runtime", 2, { scanGenerationStatus: generation("scanning", 1) }));
  await flush();
  assert.equal(view.getSnapshot().resources.runtime.data?.scanGenerationStatus?.scannedCount, 9);
  view.accept(snapshot("config", 12, { ...config, skipDirIds: ["hidden"] }));
  streams[0].snapshot(snapshot("config", 11, config));
  assert.deepEqual(view.getSnapshot().resources.config.data?.skipDirIds, ["hidden"]);
});

test("HTTP error snapshots retain their versions without changing authentication errors", async (t) => {
  const missing: api.DriveSnapshot = { driveId: "a", resource: "config", epoch: "server", revision: 2, updatedAt: "now", status: 404, error: "Drive missing" };
  const failed: api.DriveSnapshot = { ...missing, resource: "storage", revision: 3, status: 500, error: "Disk failed" };
  const responses = [
    Response.json(missing, { status: 404 }),
    Response.json(failed, { status: 500 }),
    new Response("unauthorized", { status: 401 }),
    Response.json({ ...missing, status: 403 }, { status: 403 }),
    new Response("route missing", { status: 404 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  assert.deepEqual(await api.getDriveSnapshot("a", "config"), missing);
  assert.deepEqual(await api.getDriveSnapshot("a", "storage"), failed);
  await assert.rejects(api.getDriveSnapshot("a", "config"), api.UnauthorizedError);
  await assert.rejects(api.getDriveSnapshot("a", "config"), (error) => error instanceof api.APIResponseError && error.status === 403);
  await assert.rejects(api.getDriveSnapshot("a", "config"), (error) => error instanceof api.APIResponseError && error.status === 404);
});

test("a late HTTP 404 cannot erase a newer configuration or stop its stream", async (t) => {
  const oldResponse = deferred<Response>();
  let oldRead!: Promise<api.DriveSnapshot>;
  t.mock.method(globalThis, "fetch", () => oldResponse.promise);
  const { view, streams } = harness((_id, resource, signal) => resource === "runtime"
    ? (oldRead = api.getDriveSnapshot("a", resource, signal)) : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("config", 10, { ...config, name: "Recreated" }));
  oldResponse.resolve(Response.json({ ...snapshot("runtime", 2), data: undefined, status: 404, error: "Drive missing" }, { status: 404 }));
  await oldRead.catch(() => undefined);
  await flush();
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.config.data?.name, "Recreated");
  assert.equal(view.getSnapshot().connection, "live");
  assert.equal(streams[0].closed, false);
});

test("a late HTTP failure from the old process cannot replace a restarted process's state", async (t) => {
  const oldResponse = deferred<Response>();
  let oldRead!: Promise<api.DriveSnapshot>;
  t.mock.method(globalThis, "fetch", () => oldResponse.promise);
  const { view, streams } = harness((_id, resource, signal) => resource === "runtime"
    ? (oldRead = api.getDriveSnapshot("a", resource, signal)) : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("runtime", 1, data.runtime, "restarted"));
  oldResponse.resolve(Response.json({ ...snapshot("runtime", 100), data: undefined, status: 404, error: "Drive missing" }, { status: 404 }));
  await oldRead.catch(() => undefined);
  await flush();
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.runtime.error, "");
  assert.equal(view.getSnapshot().resources.runtime.revision, 1);
  assert.equal(streams[0].closed, false);
});

test("a resource HTTP 404 confirms deletion through config before stopping background work", async (t) => {
  const response = deferred<Response>();
  let read!: Promise<api.DriveSnapshot>;
  let deleted = false;
  t.mock.method(globalThis, "fetch", () => response.promise);
  const { view, streams } = harness((_id, resource, signal) => resource === "runtime"
    ? (read = api.getDriveSnapshot("a", resource, signal)) : Promise.resolve(resource === "config" && deleted
      ? { ...snapshot("config", 2), data: undefined, status: 404, error: "Drive missing" } : snapshot(resource)));
  t.after(view.retain());
  await flush();
  deleted = true;
  response.resolve(Response.json({ ...snapshot("runtime", 10), data: undefined, status: 404, error: "Drive missing" }, { status: 404 }));
  await read.catch(() => undefined);
  await flush();
  assert.equal(view.getSnapshot().notFound, true);
  assert.equal(view.getSnapshot().resources.config.data, undefined);
  assert.equal(view.getSnapshot().connection, "paused");
  assert.equal(streams[0].closed, true);
});

test("resource failures follow revision order and preserve the last successful data", async (t) => {
  const oldResponse = deferred<Response>();
  let oldRead!: Promise<api.DriveSnapshot>;
  t.mock.method(globalThis, "fetch", () => oldResponse.promise);
  const { view, streams } = harness((_id, resource, signal) => resource === "storage"
    ? (oldRead = api.getDriveSnapshot("a", resource, signal)) : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("storage", 10));
  oldResponse.resolve(Response.json({ ...snapshot("storage", 2), data: undefined, status: 500, error: "Old disk failure" }, { status: 500 }));
  await oldRead.catch(() => undefined);
  await flush();
  assert.equal(view.getSnapshot().resources.storage.error, "");
  assert.equal(view.getSnapshot().resources.storage.revision, 10);
  streams[0].snapshot({ ...snapshot("storage", 11), data: undefined, status: 500, error: "Current disk failure" });
  assert.equal(view.getSnapshot().resources.storage.error, "Current disk failure");
  assert.deepEqual(view.getSnapshot().resources.storage.data, data.storage);
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(streams[0].closed, false);
});

test("a server restart accepts the new epoch and ignores late responses from the old server", async (t) => {
  const read = deferred<api.DriveSnapshot>();
  const { view, streams } = harness((_id, resource) => resource === "runtime" ? read.promise : Promise.resolve(snapshot(resource)));
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("runtime", 1, { scanGenerationStatus: generation("scanning", 20) }, "restarted"));
  read.resolve(snapshot("runtime", 100, { scanGenerationStatus: generation("scanning", 2) }));
  await flush();
  assert.equal(view.getSnapshot().resources.runtime.data?.scanGenerationStatus?.scannedCount, 20);
});

test("task completion refreshes counts and storage without waiting for their regular intervals", async (t) => {
  const { view, streams, calls } = harness();
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("runtime", 10, { scanGenerationStatus: generation("scanning", 3) }));
  const before = calls.length;
  streams[0].snapshot(snapshot("runtime", 11, { scanGenerationStatus: generation("idle") }));
  await flush();
  assert.deepEqual(calls.slice(before).sort(), ["stats", "storage"]);
});

test("mixed initial responses across a restart cannot retire the new server epoch", async (t) => {
  const oldConfig = deferred<api.DriveSnapshot>();
  let configReads = 0;
  const { view } = harness((_id, resource) => {
    if (resource === "config" && configReads++ === 0) return oldConfig.promise;
    return Promise.resolve(snapshot(resource, 1, resource === "config" ? { ...config, name: "Current" } : data[resource], "new-server"));
  });
  t.after(view.retain());
  await flush();
  oldConfig.resolve(snapshot("config", 100, { ...config, name: "Previous process" }));
  await flush();
  assert.equal(view.getSnapshot().resources.config.data?.name, "Current");
  assert.equal(view.getSnapshot().resources.runtime.revision, 1);
  assert.equal(configReads, 2);
});

test("a disconnected stream activates fallback and reconnects with stale callbacks disabled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { view, streams, calls } = harness();
  t.after(view.retain());
  await flush();
  streams[0].open();
  const before = calls.length;
  streams[0].error();
  await flush();
  assert.equal(streams[0].closed, true);
  assert.equal(view.getSnapshot().connection, "reconnecting");
  assert.equal(calls.length, before + 4);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(streams.length, 2);
  streams[1].snapshot(snapshot("config", 20, { ...config, name: "Recovered" }));
  streams[0].snapshot(snapshot("config", 100, { ...config, name: "Old connection" }));
  assert.equal(view.getSnapshot().resources.config.data?.name, "Recovered");
  assert.equal(view.getSnapshot().connection, "live");
});

test("pause cancels reads and connections, preserves data, and immediately revalidates on resume", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { view, streams, calls } = harness();
  const release = view.retain();
  await flush();
  release();
  const before = calls.length;
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(calls.length, before);
  assert.equal(streams[0].closed, true);
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
  t.after(view.retain());
  await flush();
  assert.equal(calls.length, before + 4);
  assert.equal(streams.length, 2);
});

test("live streams rely on server reconciliation and disable periodic HTTP reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { view, streams, calls } = harness();
  t.after(view.retain());
  await flush();
  streams[0].open();
  const before = calls.length;
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(15_000); streams[0].open(); await flush(); }
  assert.equal(calls.length, before);
});

test("a late resource 404 cannot erase a recreated drive with unchanged config content", async (t) => {
  const { view, calls, streams } = harness();
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("config", 1));
  const before = calls.length;
  streams[0].snapshot({ ...snapshot("runtime", 2), data: undefined, status: 404, error: "Previous drive missing" });
  await flush();
  assert.deepEqual(calls.slice(before), ["config"]);
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.config.revision, 1);
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
  assert.equal(streams[0].closed, false);
});

test("only config can confirm deletion even when another resource has a higher revision", async (t) => {
  const { view, streams } = harness();
  t.after(view.retain());
  await flush();
  streams[0].snapshot(snapshot("stats", 100));
  streams[0].snapshot({ ...snapshot("config", 2), data: undefined, status: 404, error: "Drive missing" });
  assert.equal(view.getSnapshot().notFound, true);
  assert.equal(view.getSnapshot().resources.config.data, undefined);
  assert.equal(view.getSnapshot().resources.stats.data, undefined);
  assert.equal(streams[0].closed, true);
});

test("existence confirmation cancels a config read that predates the resource 404", async (t) => {
  const oldConfig = deferred<api.DriveSnapshot>();
  let firstSignal!: AbortSignal;
  let configReads = 0;
  const { view, streams } = harness((_id, resource, signal) => {
    if (resource === "config" && configReads++ === 0) { firstSignal = signal; return oldConfig.promise; }
    return Promise.resolve(snapshot(resource));
  });
  t.after(view.retain());
  await flush();
  streams[0].snapshot({ ...snapshot("runtime", 10), data: undefined, status: 404, error: "Old drive missing" });
  await flush();
  assert.equal(firstSignal.aborted, true);
  assert.equal(configReads, 2);
  oldConfig.resolve({ ...snapshot("config", 20), data: undefined, status: 404, error: "Old config missing" });
  await flush();
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
});

test("explicit retry reopens a missing drive without releasing the page", async (t) => {
  let exists = false;
  const { view, streams } = harness(async (_id, resource) => resource === "config" && !exists
    ? { ...snapshot(resource, 2), data: undefined, status: 404, error: "Drive missing" } : snapshot(resource, 3));
  t.after(view.retain());
  await flush();
  assert.equal(view.getSnapshot().notFound, true);
  assert.equal(streams[0].closed, true);
  exists = true;
  await view.refresh();
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.config.data?.name, "A");
  assert.ok(view.getSnapshot().resources.stats.data);
  assert.equal(streams.length, 2);
  assert.equal(streams[1].closed, false);
});

test("authorization loss stops all background work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { view, calls, streams } = harness(async (_id, resource) => { if (resource === "config") throw new api.UnauthorizedError(); return snapshot(resource); });
  t.after(view.retain());
  await flush();
  assert.equal(view.getSnapshot().unauthorized, true);
  assert.equal(streams[0].closed, true);
  const before = calls.length;
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(calls.length, before);
});

test("reopening a recreated drive does not display the deleted drive's cached counts", async (t) => {
  const nextStats = deferred<api.DriveSnapshot>();
  let statsReads = 0;
  const { view } = harness((_id, resource) => resource === "stats" && ++statsReads === 2 ? nextStats.promise : Promise.resolve(snapshot(resource)));
  const release = view.retain();
  await flush();
  assert.ok(view.getSnapshot().resources.stats.data);
  view.accept({ ...snapshot("config", 2), data: undefined, status: 404, error: "网盘不存在" });
  release();
  t.after(view.retain());
  await flush();
  assert.equal(view.getSnapshot().notFound, false);
  assert.equal(view.getSnapshot().resources.stats.data, undefined);
  nextStats.resolve(snapshot("stats", 3));
  await flush();
  assert.ok(view.getSnapshot().resources.stats.data);
});
