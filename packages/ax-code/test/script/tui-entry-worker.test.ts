import { describe, expect, test } from "vitest"
import { build } from "esbuild"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { tmpdir } from "../fixture/fixture"

const execFileAsync = promisify(execFile)

describe("TUI entry worker preload", () => {
  test.each([
    ["file", ""],
    ["eval", ""],
    ["eval", "--trace-warnings"],
  ])(
    "boots only the main thread with an inherited import in a %s worker (caller options: %s)",
    async (kind, callerOptions) => {
      await using tmp = await tmpdir()
      const entry = path.join(tmp.path, "entry.mjs")
      const marker = path.join(tmp.path, "boot-calls")
      const worker = path.join(tmp.path, "worker.mjs")
      const main = path.join(tmp.path, "main.mjs")
      await writeFile(main, "")
      await writeFile(worker, 'import { parentPort } from "node:worker_threads"; parentPort.postMessage("ready")\n')
      await build({
        entryPoints: [path.join(import.meta.dirname, "../../src/index-node-tui.ts")],
        outfile: entry,
        bundle: true,
        platform: "node",
        format: "esm",
        banner: {
          js: 'import { createRequire as createTestRequire } from "node:module"; const require = createTestRequire(import.meta.url);',
        },
        plugins: [
          {
            name: "boot-boundary",
            setup(builder) {
              builder.onResolve({ filter: /^\.\/cli\/boot$/ }, () => ({ path: "boot", namespace: "test-boot" }))
              builder.onLoad({ filter: /.*/, namespace: "test-boot" }, () => ({
                contents: `
              import { appendFileSync } from "node:fs"
              import assert from "node:assert/strict"
              import { Worker, isMainThread } from "node:worker_threads"
              appendFileSync(${JSON.stringify(marker)}, isMainThread ? "main\\n" : "worker\\n")
              export function hooks() {}
              export async function run() {
                // The real TUI boot also changes directory. A worker preload
                // must never reach this operation or import this module.
                process.chdir(process.cwd())
                assert.equal(process.env.NODE_OPTIONS, ${JSON.stringify(callerOptions || undefined)})
                assert.equal(process.env.AX_CODE_CLI_ENTRY, ${JSON.stringify(entry)})
                assert.equal(typeof globalThis.Bun.file, "function")
                const worker = ${kind === "file" ? `new Worker(new URL(${JSON.stringify(pathToFileURL(worker).href)}))` : `new Worker('import { parentPort } from "node:worker_threads"; parentPort.postMessage("ready")', { eval: true })`}
                const ready = new Promise((resolve, reject) => {
                  worker.once("message", resolve)
                  worker.once("error", reject)
                })
                const exited = new Promise((resolve, reject) => {
                  worker.once("exit", code => code === 0 ? resolve() : reject(new Error("worker exit " + code)))
                })
                const [message] = await Promise.all([ready, exited])
                process.stdout.write(message)
              }
            `,
              }))
            },
          },
        ],
      })
      const result = await execFileAsync(process.execPath, [main], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import ${pathToFileURL(entry).href}`,
          AX_CODE_LAUNCH_NODE_OPTIONS: callerOptions,
        },
        timeout: 15_000,
      })
      expect(result.stdout).toBe("ready")
      expect(result.stderr).toBe("")
      expect(await readFile(marker, "utf8")).toBe("main\n")
    },
  )
})
