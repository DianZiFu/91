import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import postcss from "postcss";
import { createPlayerHoverStylesPlugin, restrictHoverStyles } from "../scripts/hoverStyles.mjs";

function assertHoverRestricted(stylesheet: string) {
  postcss.parse(stylesheet).walkRules(rule => {
    if (!rule.selector.includes(":hover")) return;
    let guarded = false;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media" && parent.params === "(hover: hover) and (pointer: fine)") guarded = true;
    }
    assert.ok(guarded, `Unrestricted player hover: ${rule.selector}`);
  });
}

test("player style processing retains selected states and keyboard focus outside hover rules", () => {
  const css = restrictHoverStyles(".setting:hover, .setting.current { color: red; } .setting:focus-visible { outline: 2px solid blue; }");
  assertHoverRestricted(css);
  const root = postcss.parse(css);
  const selected = root.nodes.find(node => node.type === "rule" && node.selector === ".setting.current");
  const focus = root.nodes.find(node => node.type === "rule" && node.selector === ".setting:focus-visible");
  assert.ok(selected, "selected settings must remain highlighted on touch devices");
  assert.ok(focus, "keyboard focus must remain visible");
});

test("both published ArtPlayer modules inject the processed stylesheet", async () => {
  const require = createRequire(import.meta.url);
  const main = require.resolve("artplayer");
  const packageDir = resolve(dirname(main), "..");
  const metadata = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
  const plugin = await createPlayerHoverStylesPlugin();
  for (const path of [main, resolve(packageDir, metadata.module)]) {
    const code = readFileSync(path, "utf8");
    const transformed = plugin.transform(code, path);
    assert.ok(transformed);
    let stylesheet: string;
    if (path === main) {
      const module = { exports: {} as { STYLE: string } };
      const context = { module, exports: module.exports };
      runInNewContext(transformed.code, context);
      stylesheet = context.module.exports.STYLE;
    } else {
      const module = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`);
      stylesheet = module.default.STYLE;
    }
    assertHoverRestricted(stylesheet);
    const root = postcss.parse(stylesheet);
    assert.ok(root.nodes.some(node => node.type === "rule" && node.selectors.includes(".art-video-player .art-settings .art-setting-panel .art-setting-item.art-current")));
  }
  assert.equal(plugin.transform("export default {}", "/app/unrelated.js"), undefined);
});

test("a changed player stylesheet layout fails visibly instead of retaining unsafe hover", async () => {
  const require = createRequire(import.meta.url);
  const plugin = await createPlayerHoverStylesPlugin();
  assert.throws(() => plugin.transform("export default {}", require.resolve("artplayer")), /Cannot locate the ArtPlayer stylesheet/);
});
