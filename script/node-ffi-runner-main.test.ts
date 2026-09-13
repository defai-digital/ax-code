import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs"
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
