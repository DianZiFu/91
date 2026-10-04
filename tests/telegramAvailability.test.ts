import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTelegramEnabled,
  getTelegramAvailability,
  resetTelegramAvailability,
  syncTelegramAvailability,
} from "../src/admin/telegram/availability";
import { updateConfigYAML } from "../src/admin/api";

const signal = () => new AbortController().signal;

test("Telegram availability starts unresolved and follows persisted configuration", async () => {
  resetTelegramAvailability();
  assert.equal(getTelegramAvailability().enabled, null);
  await syncTelegramAvailability(async () => false, signal());
  assert.equal(getTelegramAvailability().enabled, false);
  await syncTelegramAvailability(async () => true, signal());
  assert.equal(getTelegramAvailability().enabled, true);
});

test("saving YAML publishes Telegram availability only after success", async (t) => {
  resetTelegramAvailability();
  applyTelegramEnabled(false);
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      settings: { previewEnabled: true, telegramEnabled: true },
    }),
  );
  await updateConfigYAML("telegram: {enabled: true}", "v1");
  assert.equal(getTelegramAvailability().enabled, true);
  mock.mock.mockImplementation(
    async () => new Response("invalid config", { status: 400 }),
  );
  await assert.rejects(updateConfigYAML("telegram: {enabled: false}", "v2"));
  assert.equal(getTelegramAvailability().enabled, true);
  mock.mock.mockImplementation(async () =>
    Response.json({
      settings: { previewEnabled: true, telegramEnabled: false },
    }),
  );
  await updateConfigYAML("telegram: {enabled: false}", "v2");
  assert.equal(getTelegramAvailability().enabled, false);
});

test("an older status request cannot undo a successful config save", async () => {
  resetTelegramAvailability();
  let resolve!: (enabled: boolean) => void;
  const pending = syncTelegramAvailability(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    signal(),
  );
  applyTelegramEnabled(true);
  resolve(false);
  await pending;
  assert.equal(getTelegramAvailability().enabled, true);
});

test("canceled requests and responses from a previous admin session are ignored", async () => {
  for (const cancel of ["abort", "reset"]) {
    resetTelegramAvailability();
    const controller = new AbortController();
    let resolve!: (enabled: boolean) => void;
    const pending = syncTelegramAvailability(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
      controller.signal,
    );
    if (cancel === "abort") controller.abort();
    else resetTelegramAvailability();
    resolve(true);
    await pending;
    assert.equal(getTelegramAvailability().enabled, null);
  }
});

test("status failures show an error without interpreting them as disabled", async () => {
  resetTelegramAvailability();
  const fail = async (): Promise<boolean> => {
    throw new Error("offline");
  };
  await assert.rejects(syncTelegramAvailability(fail, signal()));
  assert.equal(getTelegramAvailability().enabled, null);
  assert.ok(getTelegramAvailability().error);
  applyTelegramEnabled(true);
  await assert.rejects(syncTelegramAvailability(fail, signal()));
  assert.equal(getTelegramAvailability().enabled, true);
  await syncTelegramAvailability(async () => false, signal());
  assert.deepEqual(getTelegramAvailability(), { enabled: false, error: "" });
});
