import assert from "node:assert/strict";
import test from "node:test";
import { editorFormFromCrawler, editorFormWithImportedScript } from "../src/admin/crawlerEditor";
import { testCrawlerScript, upsertCrawler } from "../src/admin/api";

const script = {
  scriptPath: "/crawler.py", name: "Demo",
  feeds: [{ id: "latest", label: "最新", default: true }, { id: "hot", label: "最热" }],
};

test("first import selects the declared default and replacements preserve the user's choice", () => {
  const initial = editorFormWithImportedScript(editorFormFromCrawler(null), script);
  assert.equal(initial.selectedFeedId, "latest");
  const edited = { ...initial, selectedFeedId: "hot", proxy: "http://proxy", targetNew: "20" };
  const renamed = { ...script, feeds: script.feeds.map(feed => ({ ...feed, label: `${feed.label}视频` })) };
  const replaced = editorFormWithImportedScript(edited, renamed);
  assert.equal(replaced.selectedFeedId, "hot");
  assert.equal(replaced.feeds[1].label, "最热视频");
  assert.equal(replaced.proxy, edited.proxy);
  assert.equal(replaced.targetNew, "20");
});

test("a removed feed remains explicitly invalid until the user chooses again", () => {
  const initial = editorFormWithImportedScript(editorFormFromCrawler(null), script);
  const updated = editorFormWithImportedScript({ ...initial, selectedFeedId: "hot" }, {
    ...script, feeds: [script.feeds[0]], sourceUrl: "https://example.com/crawler.py",
  });
  assert.equal(updated.selectedFeedId, "hot");
  assert.equal(updated.feeds.some(feed => feed.id === updated.selectedFeedId), false);
  assert.equal(updated.scriptSourceUrl, "https://example.com/crawler.py");
});

test("saving and testing send the selected feed to the backend", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await upsertCrawler({ scriptPath: script.scriptPath, selectedFeedId: "hot" });
    await testCrawlerScript({ scriptPath: script.scriptPath, selectedFeedId: "hot" });
    assert.deepEqual(requests.map(request => request.body.selectedFeedId), ["hot", "hot"]);
    assert.ok(requests[0].url.endsWith("/crawlers"));
    assert.ok(requests[1].url.endsWith("/crawlers/test-script"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
