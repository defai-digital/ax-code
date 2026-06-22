#!/usr/bin/env node
/**
 * Bundles the Electron main process, preload script, and the web server into
 * the dist/ directory using esbuild.
 *
 * All JavaScript dependencies are inlined. Native modules (.node files) and
 * the electron runtime are kept as external requires so that electron-builder
 * can locate, sign, and unpack them correctly.
 */
import { build } from "esbuild"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs/promises"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "../../..")
const outDir = path.join(__dirname, "../dist")

await fs.mkdir(outDir, { recursive: true })
await fs.rm(path.join(outDir, "server.js"), { force: true })
await fs.rm(path.join(outDir, "server.mjs"), { force: true })

// Modules that cannot be bundled (native .node binaries or the Electron
// runtime itself). They are required at runtime from node_modules.
const nativeExternals = ["electron", "node-pty", "fsevents"]

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  external: nativeExternals,
  minify: false,
  sourcemap: false,
}

// Main process + preload + server-process entry stay CJS. The server-process
// entry runs inside a utilityProcess and requires the sibling server bundle at
// runtime, so './server.js' is kept external here just like in main.js.
await build({
  ...shared,
  format: "cjs",
  entryPoints: [
    path.join(__dirname, "../src/main.js"),
    path.join(__dirname, "../src/preload.js"),
    path.join(__dirname, "../src/server-process.js"),
  ],
  outdir: outDir,
  external: [...nativeExternals, "./server.js"],
})

// Server bundle stays CJS so bundled CommonJS dependencies can require built-ins.
// `import.meta.url` is rewritten to a CJS-compatible URL before esbuild lowers
// the bundle, avoiding the empty import_meta shim warning and runtime breakage.
await build({
  ...shared,
  format: "cjs",
  mainFields: ["module", "main"],
  entryPoints: [path.join(root, "packages/web/server/index.js")],
  outfile: path.join(outDir, "server.js"),
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "importMetaUrl",
  },
})

console.log("[electron] bundle → dist/{main,preload,server-process,server}.js")
