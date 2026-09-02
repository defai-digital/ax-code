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
import { resolveAppleSigningEnv } from "./apple-signing.mjs"

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
const { EMBEDDED_MANIFEST_NAME, prepareRuntimeIntegrityBinding } = require("./prepare-runtime-integrity.cjs")
const builderEnv = resolveAppleSigningEnv(args)

// Stage the closed-source AX Computer computer-use server into
// resources/ax-computer so electron-builder's extraResources entry resolves.
// When the release artifact is absent (OSS/dev builds) the script stages a
// README.txt placeholder instead — packaging succeeds either way.
const stage = spawnSync("bash", [path.join(__dirname, "stage-ax-computer.sh")], {
  stdio: "inherit",
  cwd: electronDir,
})
if (stage.error) throw stage.error
if (stage.status !== 0) process.exit(stage.status ?? 1)

// Stage the pinned ax-code CLI runtime into resources/ax-code so
// electron-builder's extraResources entry resolves. The electron-builder CLI
// args are forwarded so the staging script derives the same platform/arch
// target. Release builds (AX_CODE_STAGE_REQUIRED=true) fail closed when the
// pinned CLI release archive or its minisign signature is missing/invalid;
// dev/OSS builds stage a README.txt placeholder instead.
const stageAxCode = spawnSync("bash", [path.join(__dirname, "stage-ax-code.sh"), ...args], {
  stdio: "inherit",
  cwd: electronDir,
})
if (stageAxCode.error) throw stageAxCode.error
if (stageAxCode.status !== 0) process.exit(stageAxCode.status ?? 1)

// Bind the staged sidecar's authenticated non-native manifest into app.asar.
// Electron main verifies the external runtime against this trusted copy before
// spawning it. Local placeholder builds receive a non-runnable marker file.
const runtimeBinding = prepareRuntimeIntegrityBinding({
  runtimeRoot: path.join(electronDir, "resources", "ax-code"),
  outputPath: path.join(electronDir, "dist", EMBEDDED_MANIFEST_NAME),
  env: builderEnv,
})
console.log(
  runtimeBinding.status === "bound"
    ? `[electron] bound ax-code runtime manifest (${runtimeBinding.entries} entries) into app.asar`
    : "[electron] staged runtime placeholder; wrote ASAR integrity marker",
)

// Resolve electron-builder via npx (it's hoisted to the workspace root, not
// packages/electron/node_modules/.bin), matching how the macOS job invokes it.
// shell:true so `npx` resolves on the Windows runner.
const result = spawnSync("npx", ["electron-builder", `-c.electronVersion=${electronVersion}`, ...args], {
  stdio: "inherit",
  cwd: electronDir,
  shell: true,
  // Windows Authenticode is handled by the custom electron-builder sign hook
  // (scripts/sign-windows.cjs) using AzureSignTool and an Azure Key Vault key.
  // Release CI requires signing; local builds with no signing env remain
  // unsigned.
  // Local macOS release packages default to the ax-notary Keychain profile and
  // the AX Code Developer ID team. CI keeps using its explicit API-key env.
  env: builderEnv,
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// Validate the finished unpacked application, after electron-builder has
// written fuses (and after platform signing when enabled). This runs for macOS,
// Windows, and Linux and fails packaging if Electron-owned JavaScript escaped
// app.asar or the expected production fuse policy was not applied.
const verify = spawnSync(process.execPath, [path.join(__dirname, "verify-packaged-electron.cjs"), ...args], {
  stdio: "inherit",
  cwd: electronDir,
})
if (verify.error) throw verify.error
process.exit(verify.status ?? 1)
