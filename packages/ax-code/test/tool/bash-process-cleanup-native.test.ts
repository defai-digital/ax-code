import { expect, test, vi } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { signalBashProcessTree } from "../../src/tool/bash-process-cleanup"

test.skipIf(process.platform !== "win32")("synchronously terminates a Windows child and its descendant", async () => {
  const script = `
const { spawn } = require("node:child_process")
const child = spawn(process.execPath, ["-e", "process.send('ready'); setInterval(() => {}, 1000)"], {
  stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
})
child.on("message", () => process.send({ pid: child.pid }))
setInterval(() => {}, 1000)
`
  const proc = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  })
  let descendant: number | undefined
  try {
    descendant = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Child readiness timed out")), 5000)
      const fail = (error: Error) => {
        clearTimeout(timer)
        reject(error)
      }
      proc.once("error", fail)
      proc.once("exit", () => fail(new Error("Child exited before readiness")))
      proc.once("message", (message) => {
        clearTimeout(timer)
        if (typeof message !== "object" || message === null || !("pid" in message) || typeof message.pid !== "number") {
          reject(new Error("Invalid child readiness message"))
          return
        }
        resolve(message.pid)
      })
    })
    expect(signalBashProcessTree(proc.pid!, "SIGKILL")).toBe(true)
    await vi.waitFor(
      () => {
        expect(() => process.kill(proc.pid!, 0)).toThrow()
        expect(() => process.kill(descendant!, 0)).toThrow()
      },
      { timeout: 5000 },
    )
  } finally {
    // Independent cleanup must still reap fixture processes if the assertion fails.
    for (const pid of [proc.pid, descendant]) {
      if (pid === undefined) continue
      try {
        process.kill(pid, 0)
        spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore", windowsHide: true, timeout: 5000 })
      } catch {
        // Already reaped.
      }
    }
    if (proc.connected) proc.disconnect()
  }
})
