import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";

const HOVER_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function restrictHoverStyles(stylesheet) {
  const root = postcss.parse(stylesheet);
  const rules = [];
  root.walkRules(rule => {
    if (!rule.selectors.some(selector => /:hover\b/.test(selector))) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media" && parent.params === HOVER_POINTER_QUERY) return;
    }
    rules.push(rule);
  });
  for (const rule of rules) {
    const hover = rule.selectors.filter(selector => /:hover\b/.test(selector));
    const other = rule.selectors.filter(selector => !/:hover\b/.test(selector));
    const media = postcss.atRule({ name: "media", params: HOVER_POINTER_QUERY });
    media.append(rule.clone({ selector: hover.join(", ") }));
    if (other.length) {
      rule.selector = other.join(", ");
      rule.after(media);
    } else {
      rule.replaceWith(media);
    }
  }
  return root.toString();
}

/** ArtPlayer injects CSS from a JavaScript string, outside Vite's CSS pipeline.
 * Use its exported STYLE value to identify that asset and replace only the
 * stylesheet before the library injects it. No dependency files are modified. */
export async function createPlayerHoverStylesPlugin() {
  const require = createRequire(import.meta.url);
  const commonJS = require.resolve("artplayer");
  const packageDir = resolve(dirname(commonJS), "..");
  const metadata = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
  const paths = new Set([commonJS, resolve(packageDir, metadata.module)]);
  const styles = new Map();
  for (const path of paths) {
    const { default: Artplayer } = await import(pathToFileURL(path).href);
    if (typeof Artplayer.STYLE !== "string") throw new Error("ArtPlayer no longer exposes its stylesheet");
    const doubleQuoted = JSON.stringify(Artplayer.STYLE);
    const singleQuoted = "'" + doubleQuoted.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'";
    styles.set(path.replaceAll("\\", "/"), {
      // Published builds use different quotes and may leave tab characters raw.
      literals: [doubleQuoted, singleQuoted, doubleQuoted.replace(/\\t/g, "\t"), singleQuoted.replace(/\\t/g, "\t")],
      replacement: JSON.stringify(restrictHoverStyles(Artplayer.STYLE)),
    });
  }
  return {
    name: "player-hover-styles",
    enforce: "pre",
    transform(code, id) {
      const style = styles.get(id.split("?")[0].replaceAll("\\", "/"));
      if (!style) return;
      const literal = style.literals.find(candidate => code.includes(candidate));
      if (!literal || code.indexOf(literal) !== code.lastIndexOf(literal)) {
        throw new Error("Cannot locate the ArtPlayer stylesheet; review the hover style integration");
      }
      return { code: code.replace(literal, style.replacement), map: null };
    },
  };
}
