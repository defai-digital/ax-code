import { expect, test, vi } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"
import yargs from "yargs"
import {
  commandTokenFromArgv,
  composeRunMessage,
  findRunModelError,
  formatRunToolFallbackInput,
  isRunEventStreamFormat,
  joinRunMessageArguments,
  missingRunPromptMessage,
  refreshRunProvidersOnModelMiss,
  resolveRunAgentDisplayName,
  resolveRunModel,
  RunCommand,
  runUnknownArgumentHint,
} from "../../src/cli/cmd/run"
import { tmpdir } from "../fixture/fixture"
import { Provider } from "../../src/provider/provider"

async function parseRunArgv(argv: string[]) {
  let parsed: Record<string, unknown> | undefined
  await yargs(["run", ...argv])
    .scriptName("ax-code")
    .parserConfiguration({ "populate--": true })
    .command({
      command: RunCommand.command,
      describe: RunCommand.describe,
      builder: RunCommand.builder,
      handler: (args) => {
        parsed = args as Record<string, unknown>
      },
    })
    .parse()
  return parsed ?? {}
}

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

test("run command preserves parsed message text without adding shell quotes", () => {
  expect(joinRunMessageArguments(["tell me a short story about Japan"])).toBe("tell me a short story about Japan")
  expect(joinRunMessageArguments(["tell", "me", "a story"])).toBe("tell me a story")
  expect(joinRunMessageArguments(['say "hello"', "now"])).toBe('say "hello" now')
})

test("composeRunMessage joins prompt-file, --prompt, and positional text", () => {
  expect(
    composeRunMessage({
      promptFileText: "from file\n",
      prompt: "from flag",
      message: ["Please", "review"],
      rest: ["this"],
    }),
  ).toBe("from file\nfrom flag\nPlease review this")
  expect(composeRunMessage({ prompt: "hello" })).toBe("hello")
  expect(composeRunMessage({ message: [], rest: [] })).toBe("")
})

test("missingRunPromptMessage keeps the original first line and explains common traps", () => {
  const text = missingRunPromptMessage()
  expect(text).toContain("You must provide a message or a command.")
  expect(text).toContain("--prompt")
  expect(text).toContain("--prompt-file")
  expect(text).toContain("--file attaches files; it is not a prompt file.")
})

test("run --file does not consume following prompt words", async () => {
  const parsed = await parseRunArgv(["--file", "README.md", "Please", "review"])
  expect(parsed.file).toEqual(["README.md"])
  expect(parsed.message).toEqual(["Please", "review"])
})

test("run accepts --prompt and --prompt-file", async () => {
  const parsed = await parseRunArgv([
    "--prompt",
    "hello from agent",
    "--prompt-file",
    "./prompt.txt",
    "--model",
    "qwen",
  ])
  expect(parsed.prompt).toBe("hello from agent")
  expect(parsed["prompt-file"]).toBe("./prompt.txt")
  expect(parsed.model).toBe("qwen")
})

test("run accepts --quiet as a long-only boolean flag", async () => {
  const parsed = await parseRunArgv(["--quiet", "hello"])
  expect(parsed.quiet).toBe(true)
  const withoutFlag = await parseRunArgv(["hello"])
  expect(withoutFlag.quiet).toBe(false)

  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  // Documented in the builder, and no short alias exists.
  expect(src).toContain('.option("quiet"')
  expect(src).not.toContain('alias: ["q"]')
  // --quiet drops the header, completed tool blocks, and warnings; the error
  // path keeps rendering.
  expect(src).toContain("if (!quiet) tool(part)")
  expect(src).toContain("const warn = (message: string) => {")
  // Piped stdin and its quiet window are documented in the help text.
  expect(src).toContain("piped stdin is used as the prompt")
  expect(src).toContain("quiet window")
  expect(src).toContain('echo "Summarize README.md" | ax-code run --model qwen')
})

test("run command model validation flags unknown provider or model (#405)", () => {
  const providers = [{ id: "anthropic", models: { "claude-sonnet-4": {} } }]

  expect(findRunModelError({ providers, providerID: "anthropic", modelID: "claude-sonnet-4" })).toBeUndefined()
  expect(findRunModelError({ providers, providerID: "openai", modelID: "gpt-5" })).toContain(
    'Unknown provider "openai"',
  )
  expect(findRunModelError({ providers, providerID: "anthropic", modelID: "nope" })).toContain(
    'Model "nope" not found for provider "anthropic"',
  )
})

test("run command follows an explicit model to the connected provider serving the same SKU", async () => {
  // The native provider is disabled, so it is absent from the list; the
  // gateway serves the same model ID.
  const providers = [{ id: "127.0.0.1", models: { "deepseek-v4-pro": {}, "glm-5.3": {} } }]

  expect(resolveRunModel({ providers, providerID: "127.0.0.1", modelID: "glm-5.3" })).toEqual({
    providerID: "127.0.0.1",
    modelID: "glm-5.3",
  })
  expect(resolveRunModel({ providers, providerID: "deepseek", modelID: "deepseek-v4-pro" })).toEqual({
    providerID: "127.0.0.1",
    modelID: "deepseek-v4-pro",
  })
  expect(resolveRunModel({ providers, providerID: "deepseek", modelID: "deepseek-v9" })).toBeUndefined()

  // Catalog-only providers in the full list never serve a turn; only a
  // connected provider is a valid home for the fallback.
  const withCatalog = [{ id: "catalog-router", models: { "deepseek-v4-pro": {} } }, ...providers]
  expect(
    resolveRunModel({
      providers: withCatalog,
      connected: ["127.0.0.1"],
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
    }),
  ).toEqual({ providerID: "127.0.0.1", modelID: "deepseek-v4-pro" })
  expect(
    resolveRunModel({ providers: withCatalog, connected: [], providerID: "deepseek", modelID: "deepseek-v4-pro" }),
  ).toBeUndefined()

  // A model being present in the public catalog is not enough: an exact
  // provider selection must still be connected before the run can use it.
  expect(
    resolveRunModel({
      providers: [{ id: "deepseek", models: { "deepseek-v4-pro": {} } }],
      connected: [],
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
    }),
  ).toBeUndefined()

  // A same-SKU hit is not a model miss: no discovery wait, no re-list.
  let refreshes = 0
  const kept = await refreshRunProvidersOnModelMiss({
    providers,
    providerID: "deepseek",
    modelID: "deepseek-v4-pro",
    refresh: async () => {
      refreshes++
      return undefined
    },
  })
  expect(kept).toBe(providers)
  expect(refreshes).toBe(0)
})

test.each([
  ["deepseek", "deepseek-flash"],
  ["glm", "glm-5.3-flash"],
  ["qwen", "qwen3.8-flash"],
])("run resolves %s to Flash on a connected gateway", async (family, modelID) => {
  const requested = Provider.parseModel(family)
  const providers = [
    { id: requested.providerID, models: { [modelID]: {} } },
    { id: "gateway", models: { [modelID]: {} } },
  ]
  const input = { providers, connected: ["gateway"], ...requested }
  expect(resolveRunModel(input)).toEqual({ providerID: "gateway", modelID })
  expect(resolveRunModel({ ...input, ...Provider.parseModel(`gateway/${family}`) })).toEqual({
    providerID: "gateway",
    modelID,
  })
  const refresh = async () => {
    throw new Error("A connected Flash model must not trigger discovery")
  }
  expect(await refreshRunProvidersOnModelMiss({ ...input, refresh })).toBe(providers)
  expect(resolveRunModel({ ...input, connected: [] })).toBeUndefined()
  expect(
    resolveRunModel({
      ...input,
      providers: [{ id: "gateway", models: { "deepseek-v4-pro": {}, "glm-5.3": {}, "qwen3.8-max": {} } }],
    }),
  ).toBeUndefined()
})

test("run command validates an explicit model before creating a session", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  const refresh = src.indexOf("await refreshRunProvidersOnModelMiss(")
  const validate = src.indexOf("const modelError = findRunModelError(")
  const create = src.indexOf("await session(sdk)")

  expect(refresh).toBeGreaterThan(-1)
  expect(validate).toBeGreaterThan(-1)
  expect(validate).toBeGreaterThan(refresh)
  expect(create).toBeGreaterThan(validate)
  expect(src).toContain("const initialProviders = await listProviders()")
  expect(src).toContain("if (!args.attach) await Provider.ready()")
  expect(src).toContain("[Provider.DISCOVERY_WAIT_HEADER]")
})

test("run command waits for discovery only after the requested model misses", async () => {
  const known = [{ id: "qwen", models: { max: {} } }]
  let fastPathRefreshes = 0
  const fastPath = await refreshRunProvidersOnModelMiss({
    providers: known,
    providerID: "qwen",
    modelID: "max",
    refresh: async () => {
      fastPathRefreshes++
      return undefined
    },
  })
  expect(fastPath).toBe(known)
  expect(fastPathRefreshes).toBe(0)

  let release = () => {}
  let settled = false
  const discovery = new Promise<void>((resolve) => {
    release = resolve
  })

  const local = refreshRunProvidersOnModelMiss({
    providers: known,
    providerID: "grok-build-cli",
    modelID: "grok-4.5",
    refresh: async () => {
      await discovery
      return [{ id: "grok-build-cli", models: { "grok-4.5": {} } }]
    },
  }).then((providers) => {
    settled = true
    return providers
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  release()
  await expect(local).resolves.toEqual([{ id: "grok-build-cli", models: { "grok-4.5": {} } }])
  expect(settled).toBe(true)
})

test("attached run event rendering does not read local agent state", async () => {
  let localReads = 0
  let attachedReads = 0
  const attached = await resolveRunAgentDisplayName({
    agentName: "build",
    attached: true,
    listLocalAgents: async () => {
      localReads++
      return [{ name: "dev", displayName: "Dev" }]
    },
    listAttachedAgents: async () => {
      attachedReads++
      return [{ name: "build", displayName: "Build" }]
    },
  })
  expect(attached).toBe("Build")
  expect(localReads).toBe(0)
  expect(attachedReads).toBe(1)

  const local = await resolveRunAgentDisplayName({
    agentName: "dev",
    attached: false,
    listLocalAgents: async () => [{ name: "dev", displayName: "Dev" }],
    listAttachedAgents: async () => [],
  })
  expect(local).toBe("Dev")
})

test("run command awaits the event loop before bootstrap cleanup", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  const loopStart = src.indexOf("const loopPromise = loop(events.stream)")
  const sendCommand = src.indexOf("await sdk.session.command", loopStart)
  const awaitLoop = src.indexOf("await loopResult", sendCommand)

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
  expect(src).toContain('assertLoopbackHttpUrl(args.attach, "--attach URL")')
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
  expect(src).toContain('.option("output-schema"')
  expect(src).toContain("handleRunStructuredOutput(")
  expect(src).toContain('outputFile: args["output-file"],')
  expect(src).toContain("async function readFinalAssistantText")
  expect(src).toContain("assistantMessageID: string | undefined")
  expect(src).toContain("if (!assistantMessageID) return undefined")
  expect(src).toContain("finalAssistantMessageID = event.properties.info.id")
  expect(src).toContain("await sdk.session.messages({ sessionID })")

  const awaitLoop = src.indexOf("await loopResult")
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

test("non-interactive run entry points share bounded pipe input handling", async () => {
  const run = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  const headless = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/headless-run.ts"), "utf-8")

  for (const source of [run, headless]) {
    expect(source).toContain("await readNonTtyStdin()")
    expect(source).not.toContain("for await (const chunk of process.stdin)")
  }
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
  expect(attachBlock).toContain('assertLoopbackHttpUrl(args.attach, "--attach URL")')
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
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/worker.ts"), "utf-8")

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

test("TUI renderer routes native trace traps through terminal cleanup", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/context/exit.tsx"), "utf-8")

  expect(src).toContain('"SIGTRAP"')
  expect(src).toContain("registerShutdownSignals(() => exit(), { signals: TUI_EXIT_SIGNALS })")
})

test("TUI worker always forces exit after uncaught exceptions", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/worker.ts"), "utf-8")
  const start = src.indexOf('registerTuiProcessHandler(\n  "uncaughtException"')
  const end = src.indexOf("const handleGlobalEvent", start)
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, end)
  expect(block).toContain("setTimeout(() => process.exit(1), 100)")
  expect(block).not.toContain(".unref()")
  expect(end).toBeGreaterThan(start)
  expect(block).not.toContain("if (!shutdownPromise) setTimeout")

  const lifecycleSrc = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/util/lifecycle.ts"), "utf-8")
  const handlerStart = lifecycleSrc.indexOf("export function registerTuiProcessHandler")
  expect(handlerStart).toBeGreaterThan(-1)
  const handlerBlock = lifecycleSrc.slice(handlerStart)
  expect(handlerBlock).toContain("process.on(event, handler)")
  expect(handlerBlock).toContain("process.off(event, handler)")
})

test("TUI worker waits for an old event stream before replacing it", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/worker.ts"), "utf-8")

  expect(src).toContain("const startEventStream = async")
  expect(src).toContain("await eventStream.done?.catch")
  expect(src).toContain("if (signal.aborted) return")
  expect(src).toContain("const directory = input.workspaceID ?? process.cwd()")
  expect(src).toContain("await startEventStream({ directory })")
})

test("autonomous pulse timer does not keep the process alive", async () => {
  const src = await readFile(
    path.join(import.meta.dirname, "../../src/cli/tui/routes/session/autonomous-pulse.ts"),
    "utf-8",
  )

  expect(src).toContain("cancelTimer = scheduleTuiInterval(tick, {")
  expect(src).toContain("delayMs: TICK_MS")
  expect(src).toContain("unref: true")

  const timerSrc = await readFile(path.join(import.meta.dirname, "../../src/cli/tui/util/timer.ts"), "utf-8")
  const intervalStart = timerSrc.indexOf("export function scheduleTuiInterval")
  expect(intervalStart).toBeGreaterThan(-1)
  const intervalBlock = timerSrc.slice(intervalStart)
  expect(intervalBlock).toContain("const timer = setInterval(run, input.delayMs)")
  expect(intervalBlock).toContain("unrefTimer(timer, input.unref)")
  expect(intervalBlock).toContain("clearInterval(timer)")
})

test("run command defaults to concise tool output with an opt-in --full flag", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain('.option("full"')
  expect(src).toContain(
    'describe: "show full tool output (diffs, command output, todo list) instead of concise summaries"',
  )

  // The four block-rendering tools thread the flag through the dispatch.
  expect(src).toContain("bash(props<typeof BashTool>(part), full)")
  expect(src).toContain("write(props<typeof WriteTool>(part), full)")
  expect(src).toContain("edit(props<typeof EditTool>(part), full)")
  expect(src).toContain("todo(props<typeof TodoWriteTool>(part), full)")

  // Concise mode reuses the shared shaping helpers instead of printing raw output.
  expect(src).toContain('from "../../util/tool-output"')
  expect(src).toContain("tailLines(output)")
  expect(src).toContain("diffSummary(info.metadata.diff)")
  expect(src).toContain("formatDiffSummary(summary)")
  expect(src).toContain("pass --full")
})

test("run command caps error text but never hides it in concise mode", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain("const cappedError = tailLines(part.state.error)")
  expect(src).toContain("UI.error(cappedError.text)")
  // The full flag still restores uncapped errors.
  expect(src).toContain("UI.error(part.state.error)")
})

test("run command json format still short-circuits before tool rendering", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  const emitShort = src.indexOf('if (emit("tool_use", { part })) continue')
  const render = src.indexOf("tool(part)", emitShort)
  expect(emitShort).toBeGreaterThan(-1)
  expect(render).toBeGreaterThan(emitShort)
})

test("run --format jsonl/ndjson alias the NDJSON event stream (#419)", async () => {
  // `json` is the legacy name for the newline-delimited JSON event stream;
  // the aliases make the NDJSON nature explicit and all three select the
  // exact same emit path, so downstream parsers see identical output.
  expect(isRunEventStreamFormat("json")).toBe(true)
  expect(isRunEventStreamFormat("jsonl")).toBe(true)
  expect(isRunEventStreamFormat("ndjson")).toBe(true)
  expect(isRunEventStreamFormat("default")).toBe(false)
  expect(isRunEventStreamFormat(undefined)).toBe(false)

  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  expect(src).toContain('choices: ["default", "json", "jsonl", "ndjson"]')
  // Help text must say the stream is newline-delimited — not a single JSON
  // document — so `| jq` users pick the right tool (#419).
  expect(src).toContain("newline-delimited JSON event stream")
  expect(src).toContain("not a single JSON document")
  // Every format gate routes through the shared helper so the aliases behave
  // identically to `json` in the event loop.
  expect(src).toContain("if (isRunEventStreamFormat(args.format)) {")
  expect(src).toContain("!isRunEventStreamFormat(args.format)")
  expect(src).not.toContain('args.format === "json"')
  expect(src).not.toContain('args.format !== "json"')
})

test("run exits 1 when --fork is passed without --continue or --session (#416)", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.cwd()
  process.chdir(tmp.path)
  try {
    await expect(
      RunCommand.handler({
        message: ["hello"],
        fork: true,
        command: false,
        "--": [],
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)
  } finally {
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("unknown-argument hint targets only run command failures", () => {
  const hint = "Run `ax-code run --help` to see the accepted flags."
  expect(runUnknownArgumentHint("Unknown argument: bogus", "run")).toBe(hint)
  // Other commands and other failure messages get no run hint.
  expect(runUnknownArgumentHint("Unknown argument: bogus", "session")).toBeUndefined()
  expect(runUnknownArgumentHint("Unknown argument: bogus", undefined)).toBeUndefined()
  expect(runUnknownArgumentHint("Not enough non-option arguments: got 0", "run")).toBeUndefined()
  expect(runUnknownArgumentHint("Invalid values: format", "run")).toBeUndefined()
  expect(runUnknownArgumentHint(undefined, "run")).toBeUndefined()
})

test("command token derivation finds run from raw argv without yargs internals", () => {
  // The real failing invocation: strict-mode "Unknown argument" while the
  // run command is being parsed. Derivation must not depend on yargs
  // internal parse context, which does not expose the command reliably at
  // fail time.
  expect(commandTokenFromArgv(["run", "--model", "nope/x", "--nonsense", "--", "hi"])).toBe("run")
  expect(commandTokenFromArgv(["run", "--bogus"])).toBe("run")
  // Global flags before the command never hide it, including value flags.
  expect(commandTokenFromArgv(["--debug", "run", "--bogus"])).toBe("run")
  expect(commandTokenFromArgv(["--log-level", "DEBUG", "run", "--bogus"])).toBe("run")
  expect(commandTokenFromArgv(["--log-level=DEBUG", "run", "--bogus"])).toBe("run")
  // Non-run commands, flag-only argv, and post-`--` text never resolve to run.
  expect(commandTokenFromArgv(["session", "list"])).toBe("session")
  expect(commandTokenFromArgv(["--print-logs"])).toBeUndefined()
  expect(commandTokenFromArgv(["--", "run"])).toBeUndefined()
  expect(commandTokenFromArgv([])).toBeUndefined()
})

test("shared CLI failure handler appends the run unknown-argument hint", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/boot.ts"), "utf-8")
  const failStart = src.indexOf(".fail((msg, err) => {")
  const strict = src.indexOf(".strict()", failStart)
  expect(failStart).toBeGreaterThan(-1)
  expect(strict).toBeGreaterThan(failStart)
  const handler = src.slice(failStart, strict)
  expect(handler).toContain("runUnknownArgumentHint(msg, commandTokenFromArgv(rawArgv))")
  expect(handler).toContain("process.stderr.write(`${hint}\\n`)")
  // The hint lands before the help dump and the exit stays 1.
  expect(handler.indexOf("if (hint)")).toBeLessThan(handler.indexOf('cli.showHelp("log")'))
  expect(handler).toContain("process.exit(1)")
})

test("run --format json writes a structured usage error line on missing prompt", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.cwd()
  process.chdir(tmp.path)
  let output = ""
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as any)
  try {
    await expect(
      RunCommand.handler({
        message: [],
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event).toEqual({
      type: "error",
      error: { code: "usage", message: missingRunPromptMessage() },
    })
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run event stream ends with a terminal result record", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  expect(src).toContain("buildRunResultEvent(")
  expect(src).toContain("resolveRunResultStatus({ failed: runFailed, blocked: runBlocked, timedOut, cancelled })")
  expect(src).toContain("else if (runBlocked) process.exitCode = 3")
  expect(src).toContain("usage: finalUsage")
  expect(src).toContain("resultEmitted = true")
  // Blocked accounting rides the same loop that emits tool_use events.
  expect(src).toContain("if (isRunMutatingToolCompletion(part.tool, part.state.status)) successfulMutations++")
  expect(src).toContain('emit("permission_denied", {')
  // The result write happens after the structured-output wiring, so it is
  // the final stdout line of the run.
  const structured = src.indexOf("await handleRunStructuredOutput(storedFinalMessage ?? finalMessage")
  const resultWrite = src.indexOf("buildRunResultEvent({")
  expect(structured).toBeGreaterThan(-1)
  expect(resultWrite).toBeGreaterThan(structured)
})
