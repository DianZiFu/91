import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { createPlayerHoverStylesPlugin } from "./scripts/hoverStyles.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from "node:zlib";

const backendTarget = `http://127.0.0.1:${process.env.BACKEND_PORT || "9192"}`;
const backendProxy: Record<string, ProxyOptions> = {
  "/api": { target: backendTarget, xfwd: true },
  "/admin/api": { target: backendTarget, xfwd: true },
  "/peer": { target: backendTarget, xfwd: true },
  "/p": { target: backendTarget, xfwd: true },
};

const hashedAssetCacheControl = "public, max-age=31536000, immutable";

function cacheHashedAssets(
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void
) {
  if (req.url?.startsWith("/assets/")) {
    res.setHeader("Cache-Control", hashedAssetCacheControl);
  }
  next();
}

function hashedAssetCachePlugin(): Plugin {
  return {
    name: "hashed-asset-cache",
    configureServer(server) {
      server.middlewares.use(cacheHashedAssets);
    },
    configurePreviewServer(server) {
      server.middlewares.use(cacheHashedAssets);
    },
  };
}

function precompressBuildAssets(): Plugin {
  return {
    name: "precompress-build-assets",
    apply: "build",
    enforce: "post",
    writeBundle(options, bundle) {
      if (!options.dir) {
        throw new Error("precompress-build-assets requires a directory output");
      }
      for (const output of Object.values(bundle)) {
        if (!output.fileName.startsWith("assets/") || !/\.(?:css|js|json|svg)$/.test(output.fileName)) {
          continue;
        }
        // Read the file Rollup actually wrote. Vite removes internal CSS
        // markers after generateBundle hooks, so compressing the in-memory
        // asset there can create a sidecar that differs from the final hashed
        // resource despite sharing its URL.
        const assetPath = resolve(options.dir, output.fileName);
        const source = readFileSync(assetPath);
        if (source.byteLength < 1024) continue;

        writeFileSync(
          `${assetPath}.br`,
          brotliCompressSync(source, {
            params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
            },
          })
        );
        writeFileSync(`${assetPath}.gz`, gzipSync(source, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), createPlayerHoverStylesPlugin(), hashedAssetCachePlugin(), precompressBuildAssets()],
  // Keep the player's module visible to the style adapter during development.
  optimizeDeps: { exclude: ["artplayer"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 9191,
    strictPort: true,
    proxy: backendProxy,
  },
  preview: {
    host: "0.0.0.0",
    port: 9191,
    strictPort: true,
    proxy: backendProxy,
  },
});
