#!/usr/bin/env node
/**
 * Thin wrapper around electron-builder for platform-specific packaging.
 * Called by CI as: node ./scripts/package.mjs --win --x64 --publish=never
 *
 * Exists as a separate script (rather than a direct npx call) so we can add
 * platform-specific pre-packaging steps (e.g., signing setup, env coercion)
 * without modifying the CI YAML.
 */
import { spawnSync } from "child_process"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const electronDir = path.join(__dirname, "..")

// Forward all CLI args to electron-builder unchanged.
// e.g. ['--win', '--x64', '--publish=never']
const args = process.argv.slice(2)

// pnpm hoists `electron` to the workspace-root node_modules, so electron-builder
// (run from packages/electron) cannot auto-detect the version and the range in
// package.json ("^34.0.0") is not a fixed version. Resolve it explicitly and
// pass it through, matching how rebuild-native.mjs pins the Electron ABI.
const require = createRequire(import.meta.url)
const { version: electronVersion } = require("electron/package.json")

// Resolve electron-builder via npx (it's hoisted to the workspace root, not
// packages/electron/node_modules/.bin), matching how the macOS job invokes it.
// shell:true so `npx` resolves on the Windows runner.
const result = spawnSync("npx", ["electron-builder", `-c.electronVersion=${electronVersion}`, ...args], {
  stdio: "inherit",
  cwd: electronDir,
  shell: true,
  // Windows signing is read natively by electron-builder from
  // WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD, which the CI signing step sets only
  // when a certificate is present; nothing to inject here. With no cert the
  // installer + portable zip are built unsigned.
  env: process.env,
})

if (result.error) throw result.error
process.exit(result.status ?? 0)
