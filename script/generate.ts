#!/usr/bin/env -S npx tsx

import { spawnSync } from "child_process"
import { openSync, closeSync } from "fs"
import { createRequire } from "module"
import { pathToFileURL } from "url"
import path from "path"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(import.meta.dirname, "..")
const axCodeDir = path.join(repoRoot, "packages", "ax-code")
const tsxLoader = pathToFileURL(require.resolve("tsx")).href
const solidLoader = pathToFileURL(path.join(repoRoot, "script", "solid-loader.mjs")).href

function run(cmd: string, args: string[], opts: { cwd?: string; stdoutFile?: string; env?: NodeJS.ProcessEnv } = {}) {
  const fd = opts.stdoutFile ? openSync(opts.stdoutFile, "w") : "inherit"
  try {
    const result = spawnSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      env: opts.env ?? process.env,
      stdio: ["inherit", fd, "inherit"],
    })
    if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`)
  } finally {
    if (typeof fd === "number") closeSync(fd)
  }
}

// 1. Build the SDK (regenerates its client from the OpenAPI spec).
run(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "packages", "sdk", "js", "script", "build.ts")])

// 2. Regenerate the repo-level OpenAPI spec by running ax-code's CLI under Node
// (index-node-tui.ts + tsx/solid loaders; index.ts imports the Bun-only preload).
run(
  process.execPath,
  [
    "--experimental-ffi",
    "--disable-warning=ExperimentalWarning",
    `--env-file-if-exists=${path.join(repoRoot, ".env")}`,
    "--import",
    tsxLoader,
    "--import",
    solidLoader,
    "--conditions=node",
    path.join(axCodeDir, "src", "index-node-tui.ts"),
    "generate",
  ],
  {
    cwd: axCodeDir,
    stdoutFile: path.join(repoRoot, "packages", "sdk", "openapi.json"),
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(axCodeDir, "tsconfig.json") },
  },
)

// 3. Format the generated output.
run(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "script", "format.ts")])
