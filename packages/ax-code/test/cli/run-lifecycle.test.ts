import { expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"
import { formatRunToolFallbackInput } from "../../src/cli/cmd/run"

test("run command fallback tool formatter handles non-json-safe input", () => {
  const input: Record<string, unknown> = { count: 1n }
  input.self = input

  expect(formatRunToolFallbackInput(input)).toBe('{"count":"1","self":"[Circular]"}')
  expect(
    formatRunToolFallbackInput({
      toJSON: () => {
        throw new Error("boom")
      },
    }),
  ).toBe("Unknown")
})

test("run command awaits the event loop before bootstrap cleanup", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
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
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain('import { AsyncLocalStorage } from "node:async_hooks"')
  expect(src).toContain("const pathDisplayRootContext = new AsyncLocalStorage<string>()")
  expect(src).toContain("pathDisplayRootContext.getStore() ?? process.cwd()")
  expect(src).toContain("path.relative(displayRoot, input)")
  expect(src).toContain("pathDisplayRootContext.run(pathDisplayRoot")
})

test("run command restores cwd after a requested directory run", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain("const previousCwd = process.cwd()")
  expect(src).toContain("if (process.cwd() !== previousCwd)")
  expect(src).toContain("process.chdir(previousCwd)")
})

test("run command scopes the local SDK client to the runtime directory", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain("const runtimeDirectory = directory || callerCwd")
  expect(src).toContain("await bootstrap(runtimeDirectory")
  expect(src).toContain(
    "createAxCodeClient({ baseUrl: internalBaseUrl(), fetch: fetchFn, directory: runtimeDirectory })",
  )
  expect(src).not.toContain("createOpencodeClient")
  expect(src).not.toContain("OpencodeClient")
})

test("run command logs tool renderer fallback errors", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain('Log.Default.debug("tool renderer fallback"')
  expect(src).toContain("error: toErrorMessage(error)")
  expect(src).toContain("stack: error instanceof Error ? error.stack : undefined")
})

test("run command wires structured output flags after the event loop", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain('.option("output-file"')
  expect(src).toContain('.option("output-last-message"')
  expect(src).toContain('.option("output-schema"')
  expect(src).toContain("resolveRunOutputFile({")
  expect(src).toContain("async function readFinalAssistantText")
  expect(src).toContain("assistantMessageID: string | undefined")
  expect(src).toContain("if (!assistantMessageID) return undefined")
  expect(src).toContain("finalAssistantMessageID = event.properties.info.id")
  expect(src).toContain("await sdk.session.messages({ sessionID })")

  const awaitLoop = src.indexOf("await loopPromise.catch")
  const storedFinalMessage = src.indexOf(
    "const storedFinalMessage = await readFinalAssistantText(sdk, sessionID, finalAssistantMessageID)",
    awaitLoop,
  )
  const structuredOutput = src.indexOf("await handleRunStructuredOutput(storedFinalMessage ?? finalMessage", awaitLoop)
  expect(awaitLoop).toBeGreaterThan(-1)
  expect(storedFinalMessage).toBeGreaterThan(awaitLoop)
  expect(structuredOutput).toBeGreaterThan(storedFinalMessage)
})

test("headless-run clears the idle timer before checking timeout state", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/headless-run.ts"), "utf-8")
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
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/headless-run.ts"), "utf-8")

  expect(src).toContain('process.on("SIGINT", onSignal)')
  expect(src).toContain('process.on("SIGTERM", onSignal)')
  expect(src).not.toContain('process.once("SIGINT", onSignal)')
  expect(src).not.toContain('process.once("SIGTERM", onSignal)')
  expect(src).toContain('process.off("SIGINT", onSignal)')
  expect(src).toContain('process.off("SIGTERM", onSignal)')
})

test("headless-run attach mode rejects non-internal fetch targets", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/headless-run.ts"), "utf-8")
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
  const src = await readFile(path.join(import.meta.dirname, "../../src/runtime/shell-env.ts"), "utf-8")
  const start = src.indexOf("async function loadShellEnv(")
  const end = src.length
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const body = src.slice(start, end)

  expect(body).toContain("timeout: shellTimeoutMs")
  expect(body).toContain("if (code === 124)")
  expect(body).toContain('Log.Default.debug("shell env load failed"')
  expect(body).toContain("await stopShellEnvProcess(proc)")
  expect(body).toContain('Log.Default.debug("shell env load setup failed"')
  expect(src).toContain('Log.Default.debug("shell env process cleanup failed"')
  expect(src).toContain("await Process.stop(proc)")
})

test("shell env loading starts after logging is configured", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/bootstrap/env.ts"), "utf-8")
  const start = src.indexOf("export async function init(")
  expect(start).toBeGreaterThan(-1)
  const body = src.slice(start)

  expect(body.indexOf("await log({")).toBeGreaterThan(-1)
  expect(body.indexOf("startShellEnvLoad(env)")).toBeGreaterThan(body.indexOf("await log({"))
})

test("debug wait unrefs the underlying timer", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/debug/index.ts"), "utf-8")
  const waitStart = src.indexOf('command: "wait"')
  const waitEnd = src.indexOf(".demandCommand()", waitStart)
  expect(waitStart).toBeGreaterThan(-1)
  expect(waitEnd).toBeGreaterThan(waitStart)
  const body = src.slice(waitStart, waitEnd)

  expect(body).toContain("const timer = setTimeout")
  expect(body).toContain("timer.unref?.()")
  expect(body).not.toContain("setTimeout(resolve, 1_000 * 60 * 60 * 24).unref()")
})

test("auth lock polling does not keep the process alive while waiting", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/auth/index.ts"), "utf-8")
  const start = src.indexOf("async function acquireFileLock")
  const end = src.indexOf("async function invalidateProviderCacheAfterAuthChange", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const body = src.slice(start, end)
  // The poll loop sleeps via the shared util, whose timer is unref'd so a
  // pending wait never keeps the process alive.
  expect(body).toContain("sleep(LOCK_POLL_MS)")

  const timeoutSrc = await readFile(path.join(import.meta.dirname, "../../src/util/timeout.ts"), "utf-8")
  const sleepStart = timeoutSrc.indexOf("export function sleep(")
  expect(sleepStart).toBeGreaterThan(-1)
  expect(timeoutSrc.slice(sleepStart)).toContain("timer.unref?.()")
})

test("TUI worker removes signal handlers during RPC shutdown", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/tui/worker.ts"), "utf-8")

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
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/tui/worker.ts"), "utf-8")
  const start = src.indexOf('registerTuiProcessHandler(\n  "uncaughtException"')
  const end = src.indexOf("const handleGlobalEvent", start)
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, end)
  expect(block).toContain("setTimeout(() => process.exit(1), 100)")
  expect(block).not.toContain(".unref()")
  expect(end).toBeGreaterThan(start)
  expect(block).not.toContain("if (!shutdownPromise) setTimeout")

  const lifecycleSrc = await readFile(
    path.join(import.meta.dirname, "../../src/cli/cmd/tui/util/lifecycle.ts"),
    "utf-8",
  )
  const handlerStart = lifecycleSrc.indexOf("export function registerTuiProcessHandler")
  expect(handlerStart).toBeGreaterThan(-1)
  const handlerBlock = lifecycleSrc.slice(handlerStart)
  expect(handlerBlock).toContain("process.on(event, handler)")
  expect(handlerBlock).toContain("process.off(event, handler)")
})

test("TUI worker waits for an old event stream before replacing it", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/tui/worker.ts"), "utf-8")

  expect(src).toContain("const startEventStream = async")
  expect(src).toContain("await eventStream.done?.catch")
  expect(src).toContain("if (signal.aborted) return")
  expect(src).toContain("await startEventStream({ directory: input.workspaceID ?? process.cwd() })")
})

test("autonomous pulse timer does not keep the process alive", async () => {
  const src = await readFile(
    path.join(import.meta.dirname, "../../src/cli/cmd/tui/routes/session/autonomous-pulse.ts"),
    "utf-8",
  )

  expect(src).toContain("cancelTimer = scheduleTuiInterval(tick, {")
  expect(src).toContain("delayMs: TICK_MS")
  expect(src).toContain("unref: true")

  const timerSrc = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/tui/util/timer.ts"), "utf-8")
  const intervalStart = timerSrc.indexOf("export function scheduleTuiInterval")
  expect(intervalStart).toBeGreaterThan(-1)
  const intervalBlock = timerSrc.slice(intervalStart)
  expect(intervalBlock).toContain("const timer = setInterval(run, input.delayMs)")
  expect(intervalBlock).toContain("unrefTimer(timer, input.unref)")
  expect(intervalBlock).toContain("clearInterval(timer)")
})
