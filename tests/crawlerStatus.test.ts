import assert from "node:assert/strict";
import test from "node:test";
import type { AdminCrawler, CrawlerTaskResult, CrawlerUploadResult, DriveGenerationStatus } from "../src/admin/api";
import { APIResponseError, runCrawler } from "../src/admin/api";
import {
  crawlerActionReasons, crawlerActivity, crawlerBusy, crawlerCrawlStatus, crawlerGenerationStatus, crawlerTaskStatus,
  crawlerTestSummary, crawlerUploadResult, crawlerUploadStatus,
} from "../src/admin/crawlerStatus";

function crawler(overrides: Partial<AdminCrawler> = {}): AdminCrawler {
  return {
    id: "crawler", name: "Example", kind: "scriptcrawler", status: "ok", scriptPath: "/crawler.py",
    feeds: [{ id: "default", label: "默认", default: true }], selectedFeedId: "default",
    paused: false, uploadDriveId: "target", totalCrawledCount: 10, localVideoCount: 2, migratedVideoCount: 8,
    thumbnailReadyCount: 10, thumbnailPendingCount: 0, thumbnailFailedCount: 0,
    teaserReadyCount: 10, teaserPendingCount: 0, teaserFailedCount: 0,
    fingerprintReadyCount: 10, fingerprintPendingCount: 0, fingerprintFailedCount: 0,
    ...overrides,
  };
}

function task(overrides: Partial<CrawlerTaskResult> = {}): CrawlerTaskResult {
  return { taskId: "task", state: "running", stage: "discover", checked: 12, newVideos: 3, ...overrides };
}

function upload(overrides: Partial<CrawlerUploadResult> = {}): CrawlerUploadResult {
  return {
    taskId: "upload", driveId: "crawler", targetDriveId: "target", state: "succeeded",
    startedAt: "2026-09-29T10:00:00Z", finishedAt: "2026-09-29T10:01:00Z",
    candidateCount: 2, uploadedCount: 2, reusedCount: 0, blockedCount: 0, failedCount: 0,
    remainingCount: 0, issueCount: 0, ...overrides,
  };
}

function generation(state: string): DriveGenerationStatus {
  return { state, queueLength: 0, scannedCount: 0, addedCount: 0, doneCount: 0, totalCount: 0 };
}

const available = { maintenanceBusy: false, uploadTargetAvailable: true };

test("paused crawls remain busy while generation and upload finish", () => {
  for (const stage of ["generation", "upload"]) {
    const view = crawler({ currentTask: task({ stage, stopRequested: true }) });
    assert.equal(crawlerTaskStatus(view).text, "收尾中");
    assert.equal(crawlerBusy(view), true);
    assert.notEqual(crawlerActionReasons(view, available).run, "");
    view.lastCrawlResult = task({ state: "canceled", stopRequested: true });
    delete view.currentTask;
    assert.equal(crawlerBusy(view), false);
    assert.deepEqual(crawlerTaskStatus(view), { text: "空闲", tone: "idle" });
    assert.deepEqual(crawlerCrawlStatus(view), { text: "空闲", tone: "idle" });
  }
});

test("the durable task stage overrides the scan flag across the entire crawl lifecycle", () => {
  const view = crawler({ scanGenerationStatus: generation("scanning") });
  for (const [stage, text] of [
    ["discover", "抓取中"], ["resolve", "抓取中"], ["import", "抓取中"],
    ["generation", "生成中"], ["upload", "上传中"], ["unknown", "抓取中"],
  ]) {
    view.currentTask = task({ stage });
    assert.equal(crawlerActivity(view)?.text, text);
    assert.equal(crawlerTaskStatus(view).text, text);
    assert.equal(crawlerBusy(view), true);
  }
  view.currentTask = task({ state: "queued" });
  assert.equal(crawlerActivity(view)?.text, "等待中");
  view.currentTask = task({ stage: "upload" });
  view.uploadDriveId = "";
  assert.equal(crawlerActivity(view)?.text, "处理中");
  assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
});

test("finished crawls display idle while keeping their actual outcomes", () => {
  for (const state of ["completed", "partial", "failed", "canceled", "interrupted"] as const) {
    const view = crawler({ lastCrawlResult: task({ state }) });
    assert.deepEqual(crawlerTaskStatus(view), { text: "空闲", tone: "idle" });
    assert.deepEqual(crawlerCrawlStatus(view), { text: "空闲", tone: "idle" });
    assert.equal(view.lastCrawlResult?.state, state);
    assert.equal(crawlerActivity(view), undefined);
    assert.equal(crawlerBusy(view), false);
  }
});

test("generation cards share idle, waiting and active states", () => {
  assert.deepEqual(crawlerGenerationStatus(), { text: "空闲", tone: "idle" });
  for (const state of ["idle", "succeeded", "partial", "failed", "canceled", "interrupted"]) {
    assert.deepEqual(crawlerGenerationStatus(generation(state)), { text: "空闲", tone: "idle" });
  }
  for (const state of ["queued", "cooling"]) {
    assert.deepEqual(crawlerGenerationStatus(generation(state)), { text: "等待中", tone: "queued" });
  }
  for (const state of ["scanning", "uploading", "generating"]) {
    assert.deepEqual(crawlerGenerationStatus(generation(state)), { text: "进行中", tone: "generating" });
  }
});

test("the crawl card is idle during generation and upload while the pipeline remains busy", () => {
  for (const [stage, activity] of [["generation", "生成中"], ["upload", "上传中"]]) {
    for (const stopRequested of [false, true]) {
      const view = crawler({
        currentTask: task({ stage, stopRequested }),
        scanGenerationStatus: generation("scanning"),
        uploadGenerationStatus: generation(stage === "upload" ? "uploading" : "idle"),
      });
      assert.deepEqual(crawlerCrawlStatus(view), { text: "空闲", tone: "idle" });
      assert.equal(crawlerActivity(view)?.text, stopRequested ? "收尾中" : activity);
      assert.equal(crawlerUploadStatus(view).text, stage === "upload" ? "进行中" : "等待中");
      assert.equal(crawlerBusy(view), true);
      assert.notEqual(crawlerActionReasons(view, available).run, "");
    }
  }
  const localOnly = crawler({ currentTask: task({ stage: "upload" }), uploadDriveId: "" });
  assert.equal(crawlerCrawlStatus(localOnly).text, "空闲");
  assert.equal(crawlerActivity(localOnly)?.text, "处理中");
  assert.deepEqual(crawlerUploadStatus(localOnly), { text: "空闲", tone: "idle" });
});

test("the crawl card keeps acquisition progress after a canceled task and other outcomes", () => {
  const lastCrawlResult = task({ state: "canceled", stopRequested: true });
  for (const stage of ["discover", "resolve", "import"]) {
    const view = crawler({ currentTask: task({ stage }), lastCrawlResult });
    assert.deepEqual(crawlerCrawlStatus(view), { text: "进行中", tone: "generating" });
    view.currentTask!.stopRequested = true;
    assert.deepEqual(crawlerCrawlStatus(view), { text: "进行中", tone: "generating" });
  }
  assert.equal(crawlerCrawlStatus(crawler({ currentTask: task({ state: "queued" }), lastCrawlResult })).text, "等待中");
  for (const [state, text] of [["scanning", "进行中"], ["queued", "等待中"], ["cooling", "等待中"]]) {
    assert.equal(crawlerCrawlStatus(crawler({ scanGenerationStatus: generation(state), lastCrawlResult })).text, text);
  }
  assert.equal(crawlerCrawlStatus(crawler({ lastCrawlResult: task({ state: "completed" }) })).text, "空闲");
  assert.equal(crawlerCrawlStatus(crawler({ lastCrawlResult: task({ state: "failed" }) })).text, "空闲");
});

test("manual uploads leave the crawl card idle without hiding a concurrent crawl", () => {
  for (const uploadState of ["queued", "running"] as const) {
    const view = crawler({
      lastCrawlResult: task({ state: "completed" }),
      lastUploadResult: upload({ state: uploadState }),
    });
    assert.deepEqual(crawlerCrawlStatus(view), { text: "空闲", tone: "idle" });
    assert.equal(crawlerUploadStatus(view).text, uploadState === "running" ? "进行中" : "等待中");
    assert.equal(crawlerBusy(view), true);
    view.currentTask = task({ stage: "import" });
    assert.equal(crawlerCrawlStatus(view).text, "进行中");
  }
  for (const state of ["queued", "uploading", "cooling"]) {
    const view = crawler({
      lastCrawlResult: task({ state: "completed" }),
      uploadGenerationStatus: generation(state),
    });
    assert.equal(crawlerCrawlStatus(view).text, "空闲");
  }
});

test("idle upload cards do not infer activity from history or video counts", () => {
  for (const localVideoCount of [0, 20]) {
    const view = crawler({ localVideoCount, totalCrawledCount: 100 });
    assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
    view.lastUploadResult = upload({ state: "failed", message: "Target unavailable" });
    assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
    assert.equal(crawlerUploadResult(view)?.message, "Target unavailable");
  }
});

test("finished uploads display idle while keeping their outcomes available", () => {
  for (const state of ["succeeded", "partial", "blocked", "failed", "canceled", "interrupted"] as const) {
    const view = crawler({ lastUploadResult: upload({ state }) });
    assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
    assert.equal(crawlerUploadResult(view)?.state, state);
    assert.equal(crawlerBusy(view), false);
    assert.equal(crawlerActionReasons(view, available).upload, "", "failed or blocked videos can be retried");
  }
});

test("live upload progress and accepted tasks override an earlier successful result", () => {
  const view = crawler({ lastUploadResult: upload(), uploadGenerationStatus: generation("uploading") });
  assert.equal(crawlerActivity(view)?.text, "上传中");
  assert.equal(crawlerUploadStatus(view).text, "进行中");
  delete view.uploadGenerationStatus;
  view.lastUploadResult = upload({ state: "queued", targetDriveId: "" });
  assert.equal(crawlerUploadStatus(view).text, "等待中");
  assert.equal(crawlerBusy(view), true);
  assert.ok(crawlerActionReasons(view, available).run);
  assert.ok(crawlerActionReasons(view, available).upload);
  view.lastUploadResult.state = "running";
  assert.equal(crawlerUploadStatus(view).text, "进行中");
});

test("a new crawl awaiting upload cannot show the previous upload as its current success", () => {
  const view = crawler({ currentTask: task({ stage: "generation" }), lastUploadResult: upload() });
  assert.equal(crawlerUploadStatus(view).text, "等待中");
  assert.equal(crawlerUploadResult(view)?.state, "succeeded", "previous result remains available as history");
  view.currentTask!.stage = "upload";
  assert.equal(crawlerUploadStatus(view).text, "等待中");
});

test("changing upload targets does not reuse the previous target's outcome", () => {
  const view = crawler({ uploadDriveId: "new-target", lastUploadResult: upload() });
  assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
  assert.equal(crawlerUploadResult(view), undefined);
  view.uploadDriveId = "";
  assert.deepEqual(crawlerUploadStatus(view), { text: "空闲", tone: "idle" });
  view.uploadDriveId = "target";
  view.lastUploadResult = upload({ state: "failed", targetDriveId: "", message: "Failed before target lookup" });
  assert.equal(crawlerUploadStatus(view).text, "空闲");
});

test("cooling tasks keep polling, remain stoppable and prevent duplicate work", () => {
  for (const field of ["scanGenerationStatus", "thumbnailGenerationStatus", "previewGenerationStatus", "fingerprintGenerationStatus", "uploadGenerationStatus"] as const) {
    const view = crawler({ [field]: generation("cooling") });
    assert.equal(crawlerBusy(view), true);
    assert.deepEqual(crawlerActivity(view), { text: "等待中", tone: "queued" });
    const status = field === "scanGenerationStatus" ? crawlerCrawlStatus(view)
      : field === "uploadGenerationStatus" ? crawlerUploadStatus(view) : crawlerGenerationStatus(view[field]);
    assert.deepEqual(status, { text: "等待中", tone: "queued" });
    const reasons = crawlerActionReasons(view, available);
    assert.ok(reasons.run);
    assert.ok(reasons.upload);
  }
});

test("active generators take precedence over waiting generators in the row", () => {
  const view = crawler({
    thumbnailGenerationStatus: generation("cooling"),
    previewGenerationStatus: generation("generating"),
    fingerprintGenerationStatus: generation("queued"),
  });
  assert.deepEqual(crawlerActivity(view), { text: "生成中", tone: "generating" });
  assert.deepEqual(crawlerGenerationStatus(view.thumbnailGenerationStatus), { text: "等待中", tone: "queued" });
  assert.equal(crawlerBusy(view), true);
});

test("action availability covers submissions, batch jobs, script failures and upload prerequisites", () => {
  assert.deepEqual(crawlerActionReasons(crawler(), available), { run: "", upload: "" });
  for (const pending of ["run", "upload", "stop", "pause"] as const) {
    const reasons = crawlerActionReasons(crawler(), { ...available, pending });
    assert.ok(reasons.run);
    assert.ok(reasons.upload);
  }
  const batch = crawlerActionReasons(crawler(), { ...available, maintenanceBusy: true });
  assert.ok(batch.run);
  assert.ok(batch.upload);
  assert.match(crawlerActionReasons(crawler({ uploadDriveId: "" }), available).upload, /配置上传网盘/);
  assert.match(crawlerActionReasons(crawler(), { ...available, uploadTargetAvailable: false }).upload, /目标不可用/);
  assert.equal(crawlerActionReasons(crawler({ localVideoCount: 0 }), available).upload, "", "an empty upload remains clickable");
  const brokenScript = crawlerActionReasons(crawler({ scriptError: "协议不受支持" }), available);
  assert.equal(brokenScript.run, "脚本不可用，请查看日志");
  assert.equal(brokenScript.upload, "", "existing local videos can still be uploaded");
  assert.equal(crawlerActionReasons(crawler({ paused: true }), available).run, "", "scheduled pause does not disable manual runs");
});

test("test feedback only claims the checks that the backend actually validated", () => {
  const result = { ok: true, items: [], durationMs: 100, validated: [] as Array<"protocol" | "media_probe"> };
  assert.equal(crawlerTestSummary(result), "未确认验证范围");
  result.validated = ["protocol"];
  assert.equal(crawlerTestSummary(result), "协议检查通过");
  result.validated = ["protocol", "media_probe"];
  assert.equal(crawlerTestSummary(result), "协议与媒体检查通过");
  result.ok = false;
  assert.equal(crawlerTestSummary(result), "脚本测试失败");
});

test("crawler admission conflicts show the server's explanation without raw JSON", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, accepted: false, message: "爬虫配置正在更新" }, { status: 409 }));
  await assert.rejects(runCrawler("crawler"), error => error instanceof APIResponseError && error.message === "爬虫配置正在更新");
});
