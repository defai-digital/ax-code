#!/usr/bin/env bun
/**
 * Build the source distribution bundle.
 *
 * Mirrors `build.ts` but produces plain JavaScript via `Bun.build()` without
 * the `compile` option. The compiled-binary path triggers Bun's bunfs-backed
 * Worker subsystem (oven-sh/bun#26762, #27766, #29124) which is the bug
 * class ADR-002 retires; the non-compile bundle path produces vanilla
 * JavaScript that any `bun run` can execute, no bunfs involved.
 *
 * Output layout (consumed by publish-source.ts):
 *
 *   dist-source/
 *     bundle/
 *       index.js          main CLI entrypoint
 *       worker.js         TUI worker (spawned by thread.ts)
 *       parser.worker.js  opentui tree-sitter worker
 *       (plus any chunks Bun emits)
 *
 * Models snapshot and SQL migrations are embedded via `define` constants
 * exactly as the compiled build does, so the bundle is self-contained.
 */
import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import solidPlugin from "@opentui/solid/bun-plugin"
import { formatModelsSnapshot, preserveLocalProviders } from "./models-snapshot"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"

const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"
const snapshotPath = path.join(dir, "src/provider/models-snapshot.json")
if (process.env.MODELS_DEV_API_JSON || process.env.AX_CODE_UPDATE_MODELS === "1") {
  const modelsData = process.env.MODELS_DEV_API_JSON
    ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
    : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
  const existingSnapshot = JSON.parse(
    await Bun.file(snapshotPath)
      .text()
      .catch(() => "{}"),
  )
  const fetched = JSON.parse(modelsData)
  await Bun.write(snapshotPath, formatModelsSnapshot(preserveLocalProviders(fetched, existingSnapshot)))
  console.log("Generated models-snapshot.json")
} else {
  console.log("Using committed models-snapshot.json")
}

// Migrations are embedded into the bundle via the AX_CODE_MIGRATIONS define
// constant, exactly the same way the compiled build does. The runtime never
// reads the migration/ directory at runtime, so the source distribution does
// not need to ship those files.
const migrationDirs = (await fs.promises.readdir(path.join(dir, "migration"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const buildChannel = process.env.AX_CODE_CHANNEL ?? buildChannelForVersion(buildVersion)
console.log("ax-code source build", JSON.stringify({ version: buildVersion, channel: buildChannel }, null, 2))

const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorkerSrc = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
const workerPath = "./src/cli/cmd/tui/worker.ts"

const outdir = path.join(dir, "dist-source/bundle")
const stagingDir = path.join(dir, "dist-source/.staging")
await $`rm -rf ${outdir} ${stagingDir}`
await fs.promises.mkdir(outdir, { recursive: true })
await fs.promises.mkdir(stagingDir, { recursive: true })

// Stage the opentui parser worker inside the package so Bun.build keeps the
// emitted output under outdir. Pointing entrypoints at node_modules paths
// makes Bun resolve relative to the longest common prefix and write outside
// outdir (the build then has no usable parser.worker.js at the expected
// location).
const parserWorkerStaged = path.join(stagingDir, "parser.worker.js")
await fs.promises.copyFile(parserWorkerSrc, parserWorkerStaged)

// Flat output naming: index.js, worker.js, parser.worker.js — all at the
// root of bundle/. This matches the layout the runtime expects when
// resolving siblings via `new URL("./worker.js", import.meta.url)`.
//
// AX_CODE_WORKER_PATH is intentionally NOT defined for the source bundle.
// thread.ts already has a fallback that resolves the worker via
// `new URL("./worker.js", import.meta.url)` — Bun.build rewrites that
// pattern at bundle time so the runtime URL points at the bundled
// worker output.
const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  target: "bun",
  outdir,
  naming: {
    entry: "[name].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  entrypoints: ["./src/index.ts", parserWorkerStaged, workerPath],
  define: {
    AX_CODE_VERSION: `'${buildVersion}'`,
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_CHANNEL: `'${buildChannel}'`,
    // AX_CODE_LIBC and OTUI_TREE_SITTER_WORKER_PATH are bunfs-only concerns;
    // the source bundle does not need them. The opentui parser worker is
    // emitted as parser.worker.js next to index.js and resolved relatively.
  },
})

if (!result.success) {
  console.error("Bun.build() reported failure")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`Emitted ${result.outputs.length} bundle artifacts to ${path.relative(dir, outdir)}/`)
for (const output of result.outputs) {
  const rel = path.relative(outdir, output.path)
  const sizeKb = (output.size / 1024).toFixed(1)
  console.log(`  ${rel}  (${sizeKb} KB)`)
}

// Sanity: index.js and a worker bundle must exist. Without these, the
// shim and TUI will both fail at runtime — fail the build instead.
const indexPath = path.join(outdir, "index.js")
if (!fs.existsSync(indexPath)) {
  console.error(`Bundle missing index.js at ${indexPath}`)
  process.exit(1)
}
const workerCandidates = result.outputs
  .map((o) => path.relative(outdir, o.path))
  .filter((rel) => rel !== "index.js" && rel.endsWith(".js"))
if (workerCandidates.length === 0) {
  console.error("Bundle has no worker output; expected at least worker.js and parser.worker.js")
  process.exit(1)
}
console.log("Source bundle build complete.")
