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
const packageRoot = path.join(__dirname, "..")

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

// Bundle the web runtime CLI into the app so the ax-code CLI can invoke an
// installed AX Code.app even when no global `ax-code-desktop` shim is on PATH.
// ELECTRON_RUN_AS_NODE runs this entry through the packaged Electron binary;
// it launches the sibling bundled server.js for daemon mode.
await build({
  ...shared,
  format: "esm",
  entryPoints: [path.join(root, "packages/web/bin/cli.js")],
  outfile: path.join(outDir, "desktop-cli.mjs"),
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

// Copy tray icons into dist/resources so unpackaged/dev runs that resolve
// __dirname/resources still find them (packaged builds use extraResources).
const traySrc = path.join(__dirname, "../resources/icons")
const trayDest = path.join(outDir, "resources", "icons")
try {
  await fs.access(path.join(traySrc, "tray", "trayTemplate-idle.png"))
  await fs.cp(traySrc, trayDest, { recursive: true })
  console.log("[electron] copied tray icons → dist/resources/icons")
} catch {
  console.warn("[electron] tray icons missing under resources/icons/tray (tray will be skipped in dev)")
}

console.log("[electron] bundle → dist/{main,preload,server-process,server}.js + dist/desktop-cli.mjs")
