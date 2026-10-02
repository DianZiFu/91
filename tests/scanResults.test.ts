import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScanResult } from "../src/admin/api";
import { isGenerationBusy, scanOutcomeLabels } from "../src/admin/drive/scanResults";
import { ScanResultDetails } from "../src/admin/drive/ScanResultDetails";
import { ScanResultIcon } from "../src/admin/icons/ScanResultIcon";
import { SkipDirsIcon } from "../src/admin/icons/SkipDirsIcon";

const result: ScanResult = {
  driveId: "drive", state: "partial", startedAt: "2026-09-05T10:00:00Z", finishedAt: "2026-09-05T10:01:00Z",
  scannedCount: 7, addedCount: 2, updatedCount: 1, duplicateCount: 3, tombstonedCount: 1, cleanedCount: 2, errorCount: 1,
  issues: [{ stage: "discovery", message: "子目录读取失败" }],
};

test("completed scan outcomes do not block another scan", () => {
  for (const state of Object.keys(scanOutcomeLabels)) assert.equal(isGenerationBusy(state), false, state);
  for (const state of ["scanning", "cooling", "queued", "generating", "uploading"]) assert.equal(isGenerationBusy(state), true, state);
});

test("scan details retain status and counts without internal messages", () => {
  const canceled: ScanResult = { ...result, state: "canceled", message: "context canceled", errorCount: 25 };
  const markup = renderToStaticMarkup(createElement(ScanResultDetails, { result: canceled }));
  const html = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const text of ["已取消", "已扫描 7", "新增 2", "更新 1", "跳过 4", "清理 2", "错误 25"]) assert.ok(html.includes(text), text);
  assert.match(markup, /<time dateTime="2026-09-05T10:01:00Z" title="结束时间：/);
  for (const text of ["context canceled", "子目录读取失败", "日志"]) assert.ok(!html.includes(text), text);
});

test("scan results use one compact card with six inline label-value pairs", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails, { result }));
  assert.match(html, /^<section class="admin-detail-card admin-scan-result" aria-label="扫盘结果">/);
  assert.match(html, /<h2>扫盘结果<\/h2>/);
  assert.equal((html.match(/<dt>/g) ?? []).length, 6);
  assert.equal((html.match(/admin-detail-card /g) ?? []).length, 1);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /admin-scan-result__summary|admin-drive-scan|<button/);
  assert.doesNotMatch(html, /重复跳过|黑名单跳过/);
});

test("scan result headers use the supplied folder search icon in every state", () => {
  for (const props of [{ result }, {}, { scanning: true }, { loading: true }]) {
    const html = renderToStaticMarkup(createElement(ScanResultDetails, props));
    const icon = /<svg\b[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0];
    assert.ok(icon);
    assert.match(icon, /width="20" height="20"/);
    assert.match(icon, /viewBox="0 0 640 640"/);
    assert.match(icon, /aria-hidden="true" focusable="false"/);
    assert.match(icon, /<path fill="currentColor" d="M512 512L128 512/);
    assert.doesNotMatch(icon, /lucide-clipboard-list/);
  }
});

test("scan and skip-directory icons share a solid folder silhouette and size", () => {
  const scan = renderToStaticMarkup(createElement(ScanResultIcon));
  const skip = renderToStaticMarkup(createElement(SkipDirsIcon));
  for (const html of [scan, skip]) {
    assert.match(html, /width="20" height="20"/);
    assert.match(html, /viewBox="0 0 640 640"/);
    assert.match(html, /fill="currentColor"/);
    assert.match(html, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(html, /stroke=/);
  }
  assert.equal(/d="(M512[^z]+z)/.exec(scan)?.[1], /d="(M512[^z]+z)/.exec(skip)?.[1]);
  assert.match(skip, /fill-rule="evenodd"/);
  assert.notEqual(scan, skip);
});

test("scan result cards retain their title when there is no result", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails));
  assert.match(html, /aria-label="扫盘结果"/);
  assert.match(html, /暂无扫盘结果/);
  assert.doesNotMatch(html, /扫描结果|Invalid Date|结束时间|已扫描/);
});

test("scan result cards render every outcome without internal errors", () => {
  for (const [state, label] of Object.entries(scanOutcomeLabels)) {
    const html = renderToStaticMarkup(createElement(ScanResultDetails, {
      result: { ...result, state: state as ScanResult["state"], message: "internal error" },
    }));
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /internal error|子目录读取失败/);
  }
});

test("active scans show a waiting message instead of an empty or previous result", () => {
  for (const completedResult of [undefined, result]) {
    const html = renderToStaticMarkup(createElement(ScanResultDetails, {
      result: completedResult,
      scanning: true,
    }));
    assert.match(html, /扫盘进行中，请等待扫盘结束/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /暂无扫盘结果|部分完成|<time|<dl/);
  }
});

test("completed scans show their result after scanning ends", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails, { result, scanning: false }));
  assert.match(html, /部分完成/);
  assert.equal((html.match(/<dt>/g) ?? []).length, 6);
  assert.doesNotMatch(html, /扫盘进行中|暂无扫盘结果/);
});

test("scan result cards omit invalid finish times while retaining statistics", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails, {
    result: { ...result, finishedAt: "invalid" },
  }));
  assert.doesNotMatch(html, /Invalid Date|NaN|结束时间|<time/);
  assert.match(html, /<dt>已扫描<\/dt><dd>7<\/dd>/);
});

test("scan result counts omit grouping and only highlight nonzero errors", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails, {
    result: { ...result, scannedCount: 12846, addedCount: 0, updatedCount: 1234567, duplicateCount: 2345, tombstonedCount: 3456, cleanedCount: 5678, errorCount: 25000 },
  }));
  assert.match(html, /<dt>已扫描<\/dt><dd>12846<\/dd>/);
  assert.match(html, /<dt>新增<\/dt><dd class="is-zero">0<\/dd>/);
  assert.match(html, /<dt>更新<\/dt><dd>1234567<\/dd>/);
  assert.match(html, /<dt>跳过<\/dt><dd>5801<\/dd>/);
  assert.match(html, /<dt>清理<\/dt><dd>5678<\/dd>/);
  assert.match(html, /<dt>错误<\/dt><dd class="is-error">25000<\/dd>/);
  assert.doesNotMatch(html, /\d,\d/);
  const zero = renderToStaticMarkup(createElement(ScanResultDetails, {
    result: { ...result, duplicateCount: 0, tombstonedCount: 0, cleanedCount: 0, errorCount: 0 },
  }));
  assert.match(zero, /<dt>跳过<\/dt><dd class="is-zero">0<\/dd>/);
  assert.match(zero, /<dt>清理<\/dt><dd class="is-zero">0<\/dd>/);
  assert.match(zero, /<dt>错误<\/dt><dd class="is-zero">0<\/dd>/);
});

test("loading scan results reuse the compact layout without fake values", () => {
  const html = renderToStaticMarkup(createElement(ScanResultDetails, { loading: true }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<h2>扫盘结果<\/h2>/);
  assert.equal((html.match(/<dt>/g) ?? []).length, 6);
  assert.doesNotMatch(html, /暂无扫盘结果|<time|role="status"|>0</);
});
