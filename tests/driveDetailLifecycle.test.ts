import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { useDriveDetailData } from "../src/admin/drive/useDriveDetailData";

test("hidden documents and inactive retained routes close the stream and revalidate immediately on return", async (t) => {
  class TestDocument extends EventTarget { hidden = false; }
  class TestStream {
    static instances: TestStream[] = [];
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(readonly url: string) { TestStream.instances.push(this); }
    addEventListener() {}
    close() { this.closed = true; }
  }
  const document = new TestDocument();
  let renderer: ReturnType<typeof create> | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStream = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: TestStream });
  t.after(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    for (const [key, original] of [["document", originalDocument], ["window", originalWindow], ["EventSource", originalStream]] as const) {
      if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
    }
  });
  let sequence = 0;
  const fetch = t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(input, "http://localhost").pathname;
    const resource = path.split("/").at(-1)!;
    const name = ["runtime", "stats", "storage"].includes(resource) ? resource : "config";
    return Response.json({ driveId: "lifecycle", resource: name, epoch: "server", revision: ++sequence, updatedAt: "now",
      data: name === "config" ? { id: "lifecycle", kind: "quark", name: "Lifecycle", skipDirIds: [] } : {} });
  });
  let state!: ReturnType<typeof useDriveDetailData>;
  function Probe({ active }: { active: boolean }) { state = useDriveDetailData("lifecycle", active); return null; }
  await act(async () => { renderer = create(createElement(Probe, { active: true })); });
  assert.equal(fetch.mock.callCount(), 4);
  assert.equal(state.drive?.name, "Lifecycle");
  await act(async () => { document.hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal(TestStream.instances[0].closed, true);
  assert.equal(state.connection, "paused");
  assert.equal(state.drive?.name, "Lifecycle");
  await act(async () => { document.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal(fetch.mock.callCount(), 8);
  assert.equal(TestStream.instances.length, 2);
  await act(async () => { renderer!.update(createElement(Probe, { active: false })); });
  assert.equal(TestStream.instances[1].closed, true);
  await act(async () => { renderer!.update(createElement(Probe, { active: true })); });
  assert.equal(fetch.mock.callCount(), 12);
  assert.equal(TestStream.instances.length, 3);
});

test("a new authenticated page cannot redirect using the previous page's authorization failure", async (t) => {
  class TestDocument extends EventTarget { hidden = false; }
  class TestStream {
    addEventListener() {}
    close() {}
  }
  let renderer: ReturnType<typeof create> | undefined;
  const originals = ["document", "window", "EventSource"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "document", { configurable: true, value: new TestDocument() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: TestStream });
  t.after(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
    }
  });

  let authenticated = false;
  const nextRead = new Promise<Response>(() => undefined);
  t.mock.method(globalThis, "fetch", async () => authenticated ? nextRead : new Response("unauthorized", { status: 401 }));
  let redirects = 0;
  let state!: ReturnType<typeof useDriveDetailData>;
  function Probe() {
    const detail = useDriveDetailData("login-recovery", true);
    state = detail;
    useEffect(() => { if (detail.unauthorized) redirects++; }, [detail.unauthorized]);
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  assert.equal(state.unauthorized, true);
  assert.equal(redirects, 1);
  await act(async () => renderer!.unmount());

  authenticated = true;
  redirects = 0;
  await act(async () => { renderer = create(createElement(Probe)); });
  assert.equal(redirects, 0);
  assert.equal(state.unauthorized, false);
  assert.equal(state.loading, true);
});

test("switching drives retains their data within the same page instance", async (t) => {
  class TestDocument extends EventTarget { hidden = false; }
  class TestStream {
    addEventListener() {}
    close() {}
  }
  let renderer: ReturnType<typeof create> | undefined;
  const originals = ["document", "window", "EventSource"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "document", { configurable: true, value: new TestDocument() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: TestStream });
  t.after(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
    }
  });
  let sequence = 0;
  let holdReads = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (holdReads) return new Promise<Response>(() => undefined);
    const parts = new URL(input, "http://localhost").pathname.split("/");
    const driveId = parts.at(-2)!;
    const resource = parts.at(-1)!;
    return Response.json({ driveId, resource, epoch: "server", revision: ++sequence, updatedAt: "now",
      data: resource === "config" ? { id: driveId, name: driveId, skipDirIds: [] } : {} });
  });
  let state!: ReturnType<typeof useDriveDetailData>;
  function Probe({ id }: { id: string }) { state = useDriveDetailData(id, true); return null; }
  await act(async () => { renderer = create(createElement(Probe, { id: "cached-a" })); });
  assert.equal(state.drive?.name, "cached-a");
  await act(async () => renderer!.update(createElement(Probe, { id: "cached-b" })));
  assert.equal(state.drive?.name, "cached-b");
  holdReads = true;
  await act(async () => renderer!.update(createElement(Probe, { id: "cached-a" })));
  assert.equal(state.drive?.name, "cached-a");
});
