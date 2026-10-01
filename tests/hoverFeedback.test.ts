import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import postcss, { type Rule } from "postcss";

const styles = new URL("../src/styles/", import.meta.url);
const stylesheets = readdirSync(styles)
  .filter(name => name.endsWith(".css"))
  .map(name => ({ name, root: postcss.parse(readFileSync(new URL(name, styles), "utf8")) }));

function requiresHoverPointer(rule: Rule): boolean {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (
      parent.type === "atrule" &&
      parent.name === "media" &&
      /hover\s*:\s*hover/.test(parent.params) &&
      /pointer\s*:\s*fine/.test(parent.params)
    ) {
      return true;
    }
  }
  return false;
}

test("hover feedback across public, playback and admin styles requires a hover pointer", () => {
  const exposed: string[] = [];
  for (const { name, root } of stylesheets) {
    root.walkRules(rule => {
      if (rule.selectors.some(selector => /:hover\b/.test(selector)) && !requiresHoverPointer(rule)) {
        exposed.push(`${name}:${rule.source?.start?.line}: ${rule.selector}`);
      }
    });
  }
  assert.deepEqual(exposed, [], "Touch devices must not acquire hover feedback after tapping or returning");
});

test("selected, expanded, drag and keyboard focus states remain available without hovering", () => {
  for (const selector of [
    ".admin-global-action.is-active",
    ".admin-mobile-nav-toggle.is-open",
    ".backup-record.is-expanded",
    ".admin-log-toggle.is-on",
    ".admin-crawler-dropzone.is-dragover",
    ".admin-crawler-dropzone:focus-visible",
    ".admin-drive-card:focus-visible",
    ".vd-actions__share.is-success",
  ]) {
    let available = false;
    for (const { root } of stylesheets) {
      root.walkRules(rule => {
        if (rule.selectors.includes(selector) && !requiresHoverPointer(rule)) available = true;
      });
    }
    assert.ok(available, `Persistent state must not depend on a hover pointer: ${selector}`);
  }
});
