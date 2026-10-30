// Bundles the extension into dist/ with esbuild and copies the static files.
// Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

const STATIC_FILES = ["manifest.json", "popup.html", "popup.css"];
const ENTRY_POINTS = ["src/content.ts", "src/background.ts", "src/popup.ts"];

function copyStatic() {
  mkdirSync(dist, { recursive: true });
  for (const file of STATIC_FILES) cpSync(join(root, file), join(dist, file));
  cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
}

// Re-copies manifest, popup, and icons after every successful bundle so watch
// mode picks up edits to the static files too.
const copyStaticPlugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) copyStatic();
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ENTRY_POINTS.map((entry) => join(root, entry)),
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  plugins: [copyStaticPlugin],
};

rmSync(dist, { recursive: true, force: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching extension sources. Reload the extension in chrome://extensions after each change.");
} else {
  await esbuild.build(options);
}
