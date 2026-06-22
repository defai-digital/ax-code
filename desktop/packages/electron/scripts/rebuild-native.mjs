#!/usr/bin/env node
/**
 * Rebuilds native Node.js modules against the Electron ABI.
 *
 * electron-builder is configured with npmRebuild: false so it does not
 * attempt its own rebuild. This script is called explicitly before packaging
 * so we control the electron version and target architecture.
 *
 * ELECTRON_BUILDER_ARCH is set by the CI matrix to handle cross-compilation
 * (e.g., building x64 on an arm64 runner).
 */
import { rebuild } from "@electron/rebuild"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, "..")

const require = createRequire(import.meta.url)
const { version: electronVersion } = require("electron/package.json")

// CI sets ELECTRON_BUILDER_ARCH for cross-compilation; fall back to host arch.
const arch = process.env.ELECTRON_BUILDER_ARCH ?? process.arch

const modules = ["node-pty"]

console.log(`[rebuild-native] electron ${electronVersion}, arch ${arch}`)
console.log(`[rebuild-native] modules: ${modules.join(", ")}`)

await rebuild({
  buildPath: packageRoot,
  electronVersion,
  arch,
  onlyModules: modules,
  force: true,
})

console.log("[rebuild-native] done")
