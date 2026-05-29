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

  expect(src).toContain('import { AsyncLocalStorage } from "node:async_hooks"')
  expect(src).toContain("const pathDisplayRootContext = new AsyncLocalStorage<string>()")
  expect(src).toContain("pathDisplayRootContext.getStore() ?? process.cwd()")
  expect(src).toContain("path.relative(displayRoot, input)")
  expect(src).toContain("pathDisplayRootContext.run(pathDisplayRoot")
})

test("run command restores cwd after a requested directory run", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/run.ts")).text()

  expect(src).toContain("const previousCwd = process.cwd()")
  expect(src).toContain("if (process.cwd() !== previousCwd)")
  expect(src).toContain("process.chdir(previousCwd)")
})

test("run command logs tool renderer fallback errors", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/run.ts")).text()

  expect(src).toContain('Log.Default.debug("tool renderer fallback"')
  expect(src).toContain("error: toErrorMessage(error)")
  expect(src).toContain("stack: error instanceof Error ? error.stack : undefined")
})

test("headless-run clears the idle timer before checking timeout state", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/headless-run.ts")).text()
  const runStart = src.indexOf("await runHeadlessSession({")
  const timeoutCheck = src.indexOf("if (timedOut)", runStart)
  const clearTimer = src.indexOf("clearTimeout(idleTimer)", runStart)
  const callbackReset = src.indexOf("idleTimer = undefined", src.indexOf("setTimeout(() => {"))
  expect(runStart).toBeGreaterThan(-1)
  expect(callbackReset).toBeGreaterThan(-1)
  expect(clearTimer).toBeGreaterThan(runStart)
  expect(timeoutCheck).toBeGreaterThan(clearTimer)
})

test("headless-run keeps signal handlers installed until cleanup", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/headless-run.ts")).text()

  expect(src).toContain('process.on("SIGINT", onSignal)')
  expect(src).toContain('process.on("SIGTERM", onSignal)')
  expect(src).not.toContain('process.once("SIGINT", onSignal)')
  expect(src).not.toContain('process.once("SIGTERM", onSignal)')
  expect(src).toContain('process.off("SIGINT", onSignal)')
  expect(src).toContain('process.off("SIGTERM", onSignal)')
})

test("headless-run attach mode rejects non-internal fetch targets", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/headless-run.ts")).text()
  expect(src).toContain("function assertInternalUrl(url: URL)")
  expect(src).toContain('url.protocol !== "http:" && url.protocol !== "https:"')
  expect(src).toContain("Internal fetch rejected: unsupported protocol")
  expect(src).toContain("function createInternalFetch")
  expect(src).toContain("assertInternalUrl(new URL(request.url))")

  const attachStart = src.indexOf("if (args.attach) {")
  const attachEnd = src.indexOf("await bootstrap", attachStart)
  expect(attachStart).toBeGreaterThan(-1)
  expect(attachEnd).toBeGreaterThan(attachStart)

  const attachBlock = src.slice(attachStart, attachEnd)
  expect(attachBlock).toContain("const attachUrl = new URL(args.attach)")
  expect(attachBlock).toContain("assertInternalUrl(attachUrl)")
  expect(attachBlock).toContain("createInternalFetch((request) => fetch(request), headers)")
})

test("shell env loading uses shared process timeout cleanup", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/bootstrap/env.ts")).text()
  const start = src.indexOf("async function loadShellEnv(")
  const end = src.indexOf("export async function init(", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const body = src.slice(start, end)

  expect(body).toContain("timeout: shellTimeoutMs")
  expect(body).toContain("if (code === 124)")
  expect(body).toContain('Log.Default.debug("shell env load failed"')
})

test("shell env loading starts after logging is configured", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/bootstrap/env.ts")).text()
  const start = src.indexOf("export async function init(")
  expect(start).toBeGreaterThan(-1)
  const body = src.slice(start)

  expect(body.indexOf("await log({")).toBeGreaterThan(-1)
  expect(body.indexOf("shellEnvReady = loadShellEnv(env)")).toBeGreaterThan(body.indexOf("await log({"))
})

test("auth lock polling does not keep the process alive while waiting", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/auth/index.ts")).text()
  const start = src.indexOf("async function acquireFileLock")
  const end = src.indexOf("const fail =", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const body = src.slice(start, end)
  expect(body).toContain("sleepUnref(LOCK_POLL_MS)")
  expect(body).toContain("timer.unref?.()")
})

test("TUI worker removes signal handlers during RPC shutdown", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/tui/worker.ts")).text()

  // Worker now routes signal registration through the shared helper so
  // SSH disconnect (SIGHUP) and ^\ (SIGQUIT) also drain MCP children /
  // LSP servers / the HTTP server. The test still pins the "registered
  // AND removed" lifecycle, just via the helper's contract.
  expect(src).toContain("let removeSignalHandlers")
  expect(src).toContain("removeSignalHandlers?.()")
  expect(src).toContain("registerShutdownSignals(onSignal)")
  expect(src).not.toContain('process.on("SIGTERM"')
  expect(src).not.toContain('process.on("SIGINT"')
})

test("TUI worker always forces exit after uncaught exceptions", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/tui/worker.ts")).text()
  const start = src.indexOf('process.on("uncaughtException"')
  const end = src.indexOf("const handleGlobalEvent", start)
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, end)
  expect(block).toContain("setTimeout(() => process.exit(1), 100)")
  expect(block).not.toContain(".unref()")
  expect(end).toBeGreaterThan(start)
  expect(block).not.toContain("if (!shutdownPromise) setTimeout")
})

test("TUI worker waits for an old event stream before replacing it", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/tui/worker.ts")).text()

  expect(src).toContain("const startEventStream = async")
  expect(src).toContain("await eventStream.done?.catch")
  expect(src).toContain("if (signal.aborted) return")
  expect(src).toContain("await startEventStream({ directory: input.workspaceID ?? process.cwd() })")
})

test("autonomous pulse timer does not keep the process alive", async () => {
  const src = await Bun.file(
    path.join(import.meta.dir, "../../src/cli/cmd/tui/routes/session/autonomous-pulse.ts"),
  ).text()

  expect(src).toContain("timer = setInterval(tick, TICK_MS)")
  expect(src).toContain("timer.unref?.()")
})
