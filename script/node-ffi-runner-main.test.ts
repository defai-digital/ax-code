import { mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync, copyFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

for (const relative of [true, false]) {
  test(`generic runner preserves main identity and child isolation (${relative ? "relative" : "absolute"} path)`, () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ax runner main ")))
    try {
      const entry = path.join(root, "entry script.mjs")
      writeFileSync(
        entry,
        `
import { spawnSync } from "node:child_process"
import { Worker, isMainThread } from "node:worker_threads"
if (!isMainThread || !import.meta.main) throw new Error("Entry was imported as a preload")
const child = spawnSync(process.execPath, ["-e", "process.stdout.write('child-only')"], { encoding: "utf8" })
if (child.status !== 0 || child.stdout !== "child-only") throw new Error("Child entry contamination: " + child.stderr)
const worker = new Worker("require('node:worker_threads').parentPort.postMessage('worker-only')", { eval: true })
const message = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject) })
await worker.terminate()
console.log(JSON.stringify({ main: import.meta.main, argv: process.argv.slice(1), message }))
process.exitCode = 23
`,
      )
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, "node-ffi-runner.mjs"),
          relative ? "entry script.mjs" : entry,
          "argument with spaces",
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
          env: { ...process.env, NODE_OPTIONS: "", XDG_CACHE_HOME: path.join(root, "cache") },
        },
      )
      expect(result.status, result.stderr).toBe(23)
      expect(JSON.parse(result.stdout)).toEqual({
        main: true,
        argv: [entry, "argument with spaces"],
        message: "worker-only",
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("TUI runner admits equals-form preloads with spaces and records the Solid loader", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ax runner tui ")))
  try {
    mkdirSync(path.join(root, "script"), { recursive: true })
    mkdirSync(path.join(root, "packages/ax-code/src"), { recursive: true })
    for (const file of ["node-ffi-runner.mjs", "node-ffi-runner-args.mjs", "node-ffi-runner-brand.mjs"]) {
      copyFileSync(path.join(import.meta.dirname, file), path.join(root, "script", file))
    }
    writeFileSync(path.join(root, "solid-loader probe.mjs"), "globalThis.preloadProbe = 'loaded'")
    writeFileSync(
      path.join(root, "packages/ax-code/src/index-node-tui.ts"),
      `
console.log(JSON.stringify({ loaded: globalThis.preloadProbe, loader: process.env.AX_CODE_CLI_SOLID_LOADER }))
`,
    )
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "script/node-ffi-runner.mjs"),
        "--import=./solid-loader probe.mjs",
        "packages/ax-code/src/index-node-tui.ts",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, NODE_OPTIONS: "", XDG_CACHE_HOME: path.join(root, "cache") },
      },
    )
    expect(result.status, result.stderr).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.loaded).toBe("loaded")
    if (process.platform !== "win32")
      expect(output.loader).toBe(new URL("solid-loader%20probe.mjs", `file://${root}/`).href)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
