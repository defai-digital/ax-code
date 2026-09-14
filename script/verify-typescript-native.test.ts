import { expect, test } from "vitest"
import { createRequire } from "node:module"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const { runProbe } = createRequire(import.meta.url)("./verify-typescript-native.cjs") as {
  runProbe(
    command: string,
    args: string[],
    options?: object,
    timeoutMs?: number,
  ): Promise<{ status: number; stdout: string }>
}

test("native qualification returns the child result", async () => {
  const result = await runProbe(process.execPath, ["-e", 'process.stdout.write("qualified")'])
  expect(result).toMatchObject({ status: 0, stdout: "qualified" })
})

test("native qualification bounds excessive process output", async () => {
  await expect(
    runProbe(process.execPath, [
      "-e",
      'process.stdout.write("x".repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000)',
    ]),
  ).rejects.toThrow("output limit")
})

test("native qualification timeout terminates the owned descendant", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-probe-cleanup-"))
  const pidFile = path.join(directory, "child.pid")
  let childPid: number | undefined
  try {
    const program =
      'const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"}); require("node:fs").writeFileSync(process.env.PROBE_CHILD_PID_FILE, String(child.pid)); setInterval(() => {}, 1000)'
    await expect(
      runProbe(process.execPath, ["-e", program], { env: { ...process.env, PROBE_CHILD_PID_FILE: pidFile } }, 3000),
    ).rejects.toThrow("timed out")
    childPid = Number(await fs.readFile(pidFile, "utf8"))
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true)
    await expect
      .poll(
        () => {
          try {
            process.kill(childPid!, 0)
            return false
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH"
          }
        },
        { timeout: 5000 },
      )
      .toBe(true)
  } finally {
    if (childPid) {
      try {
        process.kill(childPid, "SIGKILL")
      } catch {}
    }
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 15000)

test("native qualification deadline survives a descendant retaining inherited pipes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-probe-pipes-"))
  const pidFile = path.join(directory, "child.pid")
  let guard: ReturnType<typeof setTimeout> | undefined
  try {
    const program =
      'const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {detached: true, stdio: ["ignore", process.stdout, process.stderr]}); require("node:fs").writeFileSync(process.env.PROBE_CHILD_PID_FILE, String(child.pid)); setInterval(() => {}, 1000)'
    const probe = runProbe(
      process.execPath,
      ["-e", program],
      { env: { ...process.env, PROBE_CHILD_PID_FILE: pidFile } },
      3000,
    )
    const deadline = new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error("Probe did not settle after cleanup deadline")), 9000)
    })
    await expect(Promise.race([probe, deadline])).rejects.toThrow("timed out")
  } finally {
    clearTimeout(guard)
    const pid = Number(await fs.readFile(pidFile, "utf8").catch(() => ""))
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 15000)
