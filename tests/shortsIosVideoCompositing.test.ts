import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shortsCss = readFileSync(
  new URL("../src/styles/shorts.css", import.meta.url),
  "utf8"
);
const shortsPageSource = readFileSync(
  new URL("../src/pages/ShortsPage.tsx", import.meta.url),
  "utf8"
);
const shortsPlatformSource = readFileSync(
  new URL("../src/shorts/platform.ts", import.meta.url),
  "utf8"
);
const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);
const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")
) as { icons: Array<{ src: string; sizes: string; purpose: string }> };

// iOS Safari/WebKit does not composite an inline <video> nested inside a
// `position: fixed` ancestor — the video decodes and plays but never paints
// (black screen on iOS only). The shorts page wrapper must therefore not be
// position:fixed; it locks the viewport via html/body overflow + 100svh height.
test("shorts page wrapper is not position:fixed (breaks iOS <video> compositing)", () => {
  const pageRule = /\.shorts-page \{[\s\S]*?\}/.exec(shortsCss);
  assert.ok(pageRule, ".shorts-page rule should exist");
  assert.doesNotMatch(pageRule[0], /position:\s*fixed/);
  assert.match(pageRule[0], /position:\s*relative/);
  assert.match(pageRule[0], /height:\s*100svh/);
});

test("iPhone browser preserves document scrolling with capability-gated native fullscreen", () => {
  assert.match(shortsPlatformSource, /function shouldUseDocumentScrollForShorts\(\)/);
  assert.match(shortsPlatformSource, /function isIPhoneBrowserShell\(\)/);
  assert.match(shortsPageSource, /root:\s*null/);
  assert.doesNotMatch(shortsPageSource, /supportsElementFullscreenAPI/);
  assert.match(shortsPageSource, /fullscreenSupported && !isFullscreen && \(/);
  assert.doesNotMatch(shortsPageSource, /aria-label=\{isFullscreen \? "退出全屏" : "进入全屏"\}/);
  assert.doesNotMatch(shortsPageSource, /function handleFullscreenButtonPointerDown/);
  assert.doesNotMatch(shortsPageSource, /onPointerDown=\{handleFullscreenButtonPointerDown\}/);
  assert.doesNotMatch(shortsPageSource, /onFirstPointer/);
  assert.doesNotMatch(shortsPageSource, /currentPage\.addEventListener\("pointerdown"/);
  assert.match(shortsCss, /html\.shorts-document-scroll[\s\S]*scroll-snap-type:\s*y mandatory/);
  assert.match(shortsCss, /\.shorts-page\.is-document-scroll \.shorts-feed[\s\S]*overflow-y:\s*visible/);
  assert.match(shortsCss, /\.shorts-page\.is-document-scroll \.shorts-header,[\s\S]*\.shorts-page\.is-document-scroll \.shorts-hud-toast[\s\S]*position:\s*fixed/);
});

test("app has standalone display metadata for iPhone home-screen launch", () => {
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(
    indexHtml,
    /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon-v4\.png" \/>/
  );
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(indexHtml, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
});

test("shortcuts and installed apps share a standard icon without adaptive cropping", () => {
  const favicon = /<link rel="icon"[^>]*href="([^"]+)"/.exec(indexHtml)?.[1];
  assert.ok(favicon, "The app shell should declare a favicon");
  const sharedIcon = manifest.icons.find(
    (icon) => icon.src === favicon && icon.sizes === "512x512"
  );
  assert.ok(sharedIcon, "The favicon and launcher icon should use the same asset");
  assert.ok(
    manifest.icons.every((icon) => icon.purpose === "any"),
    "Maskable icons use different scaling for Chrome shortcuts and installed apps"
  );
});
