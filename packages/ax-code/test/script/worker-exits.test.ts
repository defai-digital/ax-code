import { fork, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { observeWorkerExit } from "../support/worker-exits"

async function runWorker(script: string, action?: (child: ChildProcess) => Promise<void>) {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "worker.cjs")
  await fs.writeFile(file, script)
  const child = fork(file, { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] })
  const reports: { code: number | null; signal: NodeJS.Signals | null; pid?: number }[] = []
  observeWorkerExit(child, (exit) => reports.push(exit))
  const exited = once(child, "exit")
  try {
    if (action) await action(child)
    await exited
    expect(child.listenerCount("message")).toBe(0)
    return { reports, pid: child.pid }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
}

describe("Vitest worker exit diagnostics", () => {
  test("preserves a nonzero exit code", async () => {
    const { reports, pid } = await runWorker("process.exit(17)")
    expect(reports).toEqual([{ pid, code: 17, signal: null }])
  })

  test("reports an early zero exit without a shutdown acknowledgement", async () => {
    const { reports, pid } = await runWorker("process.exit(0)")
    expect(reports).toEqual([{ pid, code: 0, signal: null }])
  })

  test.skipIf(process.platform === "win32")("preserves an external termination signal", async () => {
    const { reports, pid } = await runWorker('process.send("ready"); setInterval(() => {}, 1000)', async (child) => {
      await once(child, "message")
      process.kill(child.pid!, "SIGTERM")
    })
    expect(reports).toEqual([{ pid, code: null, signal: "SIGTERM" }])
  })

  test("does not report the coordinator killing a worker", async () => {
    const { reports } = await runWorker('process.send("ready"); setInterval(() => {}, 1000)', async (child) => {
      await once(child, "message")
      child.kill()
    })
    expect(reports).toEqual([])
  })

  test("does not report an acknowledged Vitest shutdown", async () => {
    const { reports } = await runWorker('process.send({ type: "stopped" }, () => process.exit(0))')
    expect(reports).toEqual([])
  })
})
