import { expect, test } from "bun:test"
import path from "path"

test("run command awaits the event loop before bootstrap cleanup", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/run.ts")).text()
  const loopStart = src.indexOf("const loopPromise = loop()")
  const sendCommand = src.indexOf("await sdk.session.command", loopStart)
  const awaitLoop = src.indexOf("await loopPromise.catch", sendCommand)

  expect(loopStart).toBeGreaterThan(-1)
  expect(sendCommand).toBeGreaterThan(loopStart)
  expect(awaitLoop).toBeGreaterThan(sendCommand)
  expect(src).not.toContain("loop().catch")
  expect(src).not.toContain("console.error")
  expect(src).toContain('Log.Default.error("run event loop failed"')
})

test("run command uses the requested directory for attached path display", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/run.ts")).text()

  expect(src).toContain("let pathDisplayRoot = process.cwd()")
  expect(src).toContain("path.relative(pathDisplayRoot, input)")
  expect(src).toContain("pathDisplayRoot = directory && path.isAbsolute(directory)")
  expect(src).toContain("pathDisplayRoot = previousPathDisplayRoot")
})

test("headless-run clears the idle timer before checking timeout state", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/headless-run.ts")).text()
  const runStart = src.indexOf("await runHeadlessSession({")
  const timeoutCheck = src.indexOf("if (timedOut)", runStart)
  const clearTimer = src.indexOf("clearTimeout(idleTimer)", runStart)
  expect(runStart).toBeGreaterThan(-1)
  expect(clearTimer).toBeGreaterThan(runStart)
  expect(timeoutCheck).toBeGreaterThan(clearTimer)
})

test("shell env loading tears down the spawned shell after the read race", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/bootstrap/env.ts")).text()
  const start = src.indexOf("async function loadShellEnv(")
  const end = src.indexOf("export async function init(", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const body = src.slice(start, end)

  expect(body).toContain("if (timeoutId) clearTimeout(timeoutId)")
  expect(body).toContain("proc.kill()")
  expect(body).toContain("await proc.exited.catch")
})

test("TUI worker removes signal handlers during RPC shutdown", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/tui/worker.ts")).text()

  expect(src).toContain("let removeSignalHandlers")
  expect(src).toContain("removeSignalHandlers?.()")
  expect(src).toContain('process.off("SIGTERM", onSignal)')
  expect(src).toContain('process.off("SIGINT", onSignal)')
})
