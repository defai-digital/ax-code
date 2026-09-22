import { describe, expect, test, vi } from "vitest"
import path from "path"
import { readFile, writeFile } from "node:fs/promises"
import yargs from "yargs"
import {
  cliFailureShowsFullHelp,
  commandTokenFromArgv,
  composeRunMessage,
  findRunModelError,
  formatRunToolFallbackInput,
  isAbortError,
  isCliUsageFailureMessage,
  isRunEventStreamFormat,
  joinRunMessageArguments,
  missingRunPromptMessage,
  refreshRunProvidersOnModelMiss,
  resolveRunAgentDisplayName,
  resolveRunModel,
  RunCommand,
  runArgvUsesEventStream,
  runUsageFailureHint,
} from "../../src/cli/cmd/run"
import {
  createRunLifecycle,
  RUN_LAST_RESORT_EXIT_DELAY_MS,
  RUN_SERVER_ABORT_BOUND_MS,
} from "../../src/cli/cmd/run-lifecycle"
import { UI } from "../../src/cli/ui"
import { tmpdir } from "../fixture/fixture"
import { Provider } from "../../src/provider/provider"

// `run --runtime` resolves the managed runtime through RuntimeRegistry. Mock the
// registry so the absent-runtime handler path is exercised without touching the
// real state directory or probing a loopback server.
vi.mock("../../src/runtime/runtime-registry", () => ({
  RuntimeRegistry: {
    status: vi.fn(async () => ({ state: "absent" as const, directory: "/tmp/ax-code-project" })),
    headers: vi.fn((record: { token: string }) => ({ "x-ax-code-runtime-token": record.token })),
  },
}))

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
  // Whitespace- and trailing-comma-normalized: the local client call is one
  // logical expression, but the handler wrapper deepened its indentation past
  // printWidth so the formatter wraps it across lines.
  expect(src.replace(/\s+/g, " ").replace(/,\s*\}/g, " }")).toContain(
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
  // The final messages read carries the lifecycle abort signal (F9/F11) so a
  // hung server after the stream ended cannot keep the process alive.
  expect(src).toContain("await sdk.session.messages({ sessionID }, signal ? { signal } : undefined)")
  // --output-schema: the server-captured structured value is serialized into
  // the final text when present; the text parts stay the fallback.
  expect(src).toContain("finalStructured = extractRunStructuredOutput(result.data, assistantMessageID)")
  expect(src).toContain(
    "outputFormat !== undefined && finalStructured !== undefined ? JSON.stringify(finalStructured) : undefined",
  )

  const awaitLoop = src.indexOf("await loopResult")
  const storedFinalMessage = src.indexOf(
    "const storedFinalMessage = await readFinalAssistantText(sdk, sessionID, finalAssistantMessageID)",
    awaitLoop,
  )
  const finalText = src.indexOf("const finalText = structuredText ?? storedFinalMessage ?? finalMessage", awaitLoop)
  const structuredOutput = src.indexOf("await handleRunStructuredOutput(finalText", awaitLoop)
  expect(awaitLoop).toBeGreaterThan(-1)
  expect(storedFinalMessage).toBeGreaterThan(awaitLoop)
  expect(finalText).toBeGreaterThan(storedFinalMessage)
  expect(structuredOutput).toBeGreaterThan(finalText)
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

test("run registers one shared signal handler for SIGINT and SIGTERM and removes both", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  // CI runners send SIGTERM: both signals share one handler so either cancels
  // the run with status "cancelled" and exit 130.
  expect(src).toContain('process.once("SIGINT", onRunSignal)')
  expect(src).toContain('process.once("SIGTERM", onRunSignal)')
  expect(src).not.toContain("onSigint")
  // The finally always pairs the registrations with removals.
  expect(src).toContain('process.removeListener("SIGINT", onRunSignal)')
  expect(src).toContain('process.removeListener("SIGTERM", onRunSignal)')
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

test("run exits 1 with a structured usage line when --continue and --session are combined", async () => {
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
        message: ["hello"],
        continue: true,
        session: "ses_x",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      type: "error",
      error: { code: "usage", message: "--continue and --session are mutually exclusive" },
    })
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run validates --output-schema before submission and exits 1 on a broken schema", async () => {
  await using tmp = await tmpdir({ git: true })
  await writeFile(path.join(tmp.path, "broken.json"), "{ not json")
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
        message: ["hello"],
        "output-schema": "broken.json",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event.type).toBe("error")
    expect(event.error.code).toBe("usage")
    expect(event.error.message).toContain("Failed to parse output schema broken.json")
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run usage failures print a one-line hint instead of the full help", () => {
  const hint = "Run `ax-code run --help` to see the accepted flags."
  // Every yargs usage-failure class on `run` gets the one-line hint and never
  // the full help dump.
  for (const message of [
    "Unknown argument: bogus",
    "Not enough non-option arguments: got 0, need at least 1",
    "Invalid values: format",
    "Missing required argument: model",
  ]) {
    expect(isCliUsageFailureMessage(message)).toBe(true)
    expect(runUsageFailureHint(message, "run")).toBe(hint)
    expect(cliFailureShowsFullHelp(message, "run")).toBe(false)
    // Other commands keep the full help and get no run hint.
    expect(cliFailureShowsFullHelp(message, "session")).toBe(true)
    expect(runUsageFailureHint(message, "session")).toBeUndefined()
    expect(runUsageFailureHint(message, undefined)).toBeUndefined()
  }
  // Messages outside the usage-failure classes keep yargs defaults.
  expect(isCliUsageFailureMessage("Some other failure")).toBe(false)
  expect(runUsageFailureHint("Some other failure", "run")).toBeUndefined()
  expect(cliFailureShowsFullHelp("Some other failure", "run")).toBe(false)
  expect(cliFailureShowsFullHelp("Some other failure", "session")).toBe(false)
  expect(runUsageFailureHint(undefined, "run")).toBeUndefined()
})

test("unknown argument json on run hints at the NDJSON format flag", () => {
  expect(runUsageFailureHint("Unknown argument: json", "run")).toBe(
    "Use --format json for the NDJSON event stream (run --help lists the accepted flags).",
  )
  // Any other unknown flag keeps the generic hint, and other commands never
  // get the NDJSON hint.
  expect(runUsageFailureHint("Unknown argument: out", "run")).toBe(
    "Run `ax-code run --help` to see the accepted flags.",
  )
  expect(runUsageFailureHint("Unknown argument: json", "session")).toBeUndefined()
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

test("runArgvUsesEventStream matches run plus a stream --format value in both spellings", () => {
  // Spaced and `=` spellings, all three stream format names.
  for (const format of ["json", "jsonl", "ndjson"]) {
    expect(runArgvUsesEventStream(["run", "--format", format, "--", "hi"])).toBe(true)
    expect(runArgvUsesEventStream(["run", `--format=${format}`, "--", "hi"])).toBe(true)
  }
  // Global flags before the command do not hide it.
  expect(runArgvUsesEventStream(["--log-level", "DEBUG", "run", "--format", "json"])).toBe(true)
  // Non-stream formats, other commands, missing values, and prompt text after
  // `--` that merely spells a flag never match.
  expect(runArgvUsesEventStream(["run", "--format", "default"])).toBe(false)
  expect(runArgvUsesEventStream(["run", "--format=default"])).toBe(false)
  expect(runArgvUsesEventStream(["run"])).toBe(false)
  expect(runArgvUsesEventStream(["session", "list", "--format", "json"])).toBe(false)
  expect(runArgvUsesEventStream(["--format", "json"])).toBe(false)
  expect(runArgvUsesEventStream(["run", "--", "--format", "json"])).toBe(false)
  // A later stream format still matches after a non-stream one.
  expect(runArgvUsesEventStream(["run", "--format", "default", "--format", "json"])).toBe(true)
})

describe("createRunLifecycle", () => {
  function makeLifecycle(overrides: Partial<Parameters<typeof createRunLifecycle>[0]> = {}) {
    const calls = {
      timeoutNotices: 0,
      cancelNotices: 0,
      earlyResults: [] as Array<"timeout" | "cancelled">,
      serverAborts: [] as Array<"timeout" | "cancelled">,
    }
    const lifecycle = createRunLifecycle({
      timeoutSeconds: 0.05,
      isStream: true,
      onTimeoutNotice: () => calls.timeoutNotices++,
      onCancelNotice: () => calls.cancelNotices++,
      onEarlyResult: (status) => calls.earlyResults.push(status),
      onServerAbort: (reason) => calls.serverAborts.push(reason),
      ...overrides,
    })
    return { lifecycle, calls }
  }

  test("pre-session timeout: early result for streams, signal aborted, no server abort", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.arm()
      expect(lifecycle.timedOut()).toBe(false)
      vi.advanceTimersByTime(60)
      expect(lifecycle.timedOut()).toBe(true)
      expect(process.exitCode).toBe(124)
      expect(calls.earlyResults).toEqual(["timeout"])
      expect(calls.serverAborts).toEqual([])
      expect(lifecycle.signal.aborted).toBe(true)
      expect(lifecycle.exitCode({ failed: false, blocked: false })).toBe(124)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("text-mode timeout emits the notice instead of the early result", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle({ isStream: false })
      lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(calls.timeoutNotices).toBe(1)
      expect(calls.cancelNotices).toBe(0)
      expect(calls.earlyResults).toEqual([])
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("post-session timeout: server abort first, then the signal cut", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.arm()
      lifecycle.markSession()
      expect(lifecycle.signal.aborted).toBe(false)
      vi.advanceTimersByTime(60)
      expect(calls.serverAborts).toEqual(["timeout"])
      expect(calls.earlyResults).toEqual([])
      expect(lifecycle.signal.aborted).toBe(true)
      expect(process.exitCode).toBe(124)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("settle neuters the timer so it cannot fire into a finished run (F2)", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.arm()
      lifecycle.settle()
      expect(lifecycle.settled()).toBe(true)
      vi.advanceTimersByTime(60)
      // The settled run keeps its outcome: no timeout, no exit-code overwrite.
      expect(lifecycle.timedOut()).toBe(false)
      expect(calls.earlyResults).toEqual([])
      expect(lifecycle.exitCode({ failed: false, blocked: false })).toBeUndefined()
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("onSignal cancels: exit 130, signal aborted, server abort only after markSession (F3)", () => {
    // Pre-session: the signal commits the early cancelled result and cuts
    // the pending calls without a server abort.
    const pre = makeLifecycle()
    pre.lifecycle.onSignal()
    expect(pre.lifecycle.cancelled()).toBe(true)
    expect(process.exitCode).toBe(130)
    expect(pre.calls.earlyResults).toEqual(["cancelled"])
    expect(pre.calls.serverAborts).toEqual([])
    expect(pre.lifecycle.signal.aborted).toBe(true)
    process.exitCode = undefined

    // Post-session: the server abort is issued before the signal cut.
    const post = makeLifecycle()
    post.lifecycle.markSession()
    post.lifecycle.onSignal()
    expect(post.calls.serverAborts).toEqual(["cancelled"])
    expect(post.calls.earlyResults).toEqual([])
    expect(post.lifecycle.signal.aborted).toBe(true)
    expect(post.lifecycle.exitCode({ failed: false, blocked: false })).toBe(130)
    process.exitCode = undefined
  })

  test("pre-session signal emits exactly one early cancelled result and commits the terminal guard", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.onSignal()
      expect(lifecycle.cancelled()).toBe(true)
      expect(process.exitCode).toBe(130)
      // Stream formats: exactly one early result line, carrying the cancel
      // status — the pre-session signal behaves like the pre-session timeout.
      expect(calls.earlyResults).toEqual(["cancelled"])
      // The early result is a terminal line: the guard is committed so every
      // later writer (early errors, the result emission, the failure
      // converter) is log-only from here on.
      expect(lifecycle.terminal()).toBe(true)
      expect(calls.serverAborts).toEqual([])
      expect(lifecycle.signal.aborted).toBe(true)

      // A second signal (SIGINT then SIGTERM share the handler through two
      // `process.once` registrations) writes nothing more.
      lifecycle.onSignal()
      expect(calls.earlyResults).toEqual(["cancelled"])

      // Text mode: the same branch prints one stderr cancel notice instead
      // of the early result, and commits the same terminal outcome.
      const text = makeLifecycle({ isStream: false })
      text.lifecycle.onSignal()
      expect(text.calls.earlyResults).toEqual([])
      expect(text.calls.cancelNotices).toBe(1)
      expect(text.calls.timeoutNotices).toBe(0)
      expect(text.lifecycle.terminal()).toBe(true)
      expect(process.exitCode).toBe(130)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("pre-session timeout and signal keep the first committed terminal outcome", () => {
    vi.useFakeTimers()
    try {
      // Signal first: the cancelled result and exit 130 stand; a later
      // timeout firing adds no second line, no notice, and no exit flip.
      const signalFirst = makeLifecycle()
      signalFirst.lifecycle.onSignal()
      expect(signalFirst.calls.earlyResults).toEqual(["cancelled"])
      expect(process.exitCode).toBe(130)
      signalFirst.lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(signalFirst.lifecycle.timedOut()).toBe(true)
      expect(signalFirst.calls.earlyResults).toEqual(["cancelled"])
      expect(signalFirst.calls.timeoutNotices).toBe(0)
      expect(process.exitCode).toBe(130)
      process.exitCode = undefined

      // Timeout first: the timeout result and exit 124 stand; a later
      // signal adds no second line and does not flip the committed code.
      const timeoutFirst = makeLifecycle()
      timeoutFirst.lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(timeoutFirst.calls.earlyResults).toEqual(["timeout"])
      expect(process.exitCode).toBe(124)
      timeoutFirst.lifecycle.onSignal()
      expect(timeoutFirst.lifecycle.cancelled()).toBe(true)
      expect(timeoutFirst.calls.earlyResults).toEqual(["timeout"])
      expect(process.exitCode).toBe(124)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("exitCode precedence: error 1 > cancel 130 > timeout 124 > blocked 3 > success undefined", () => {
    const { lifecycle } = makeLifecycle()
    expect(lifecycle.exitCode({ failed: true, blocked: true })).toBe(1)
    lifecycle.onSignal()
    expect(lifecycle.exitCode({ failed: false, blocked: true })).toBe(130)
    expect(lifecycle.exitCode({ failed: true, blocked: false })).toBe(1)
    process.exitCode = undefined

    const { lifecycle: timed } = makeLifecycle()
    // Fake timers must be active before arm(): the timer is captured by
    // whatever setTimeout is global at arm time.
    vi.useFakeTimers()
    try {
      timed.arm()
      vi.advanceTimersByTime(60)
      expect(timed.exitCode({ failed: false, blocked: true })).toBe(124)
      expect(timed.exitCode({ failed: false, blocked: false })).toBe(124)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }

    const { lifecycle: plain } = makeLifecycle()
    expect(plain.exitCode({ failed: false, blocked: true })).toBe(3)
    expect(plain.exitCode({ failed: false, blocked: false })).toBeUndefined()
  })

  test("arm without a timeout is a no-op and disarm cancels a pending timer", () => {
    vi.useFakeTimers()
    try {
      const none = makeLifecycle({ timeoutSeconds: undefined })
      none.lifecycle.arm()
      vi.advanceTimersByTime(10_000)
      expect(none.lifecycle.timedOut()).toBe(false)

      const { lifecycle, calls } = makeLifecycle()
      lifecycle.arm()
      lifecycle.disarm()
      vi.advanceTimersByTime(60)
      expect(lifecycle.timedOut()).toBe(false)
      expect(calls.earlyResults).toEqual([])
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("terminal guard starts unset, sets once, and never resets", () => {
    const { lifecycle } = makeLifecycle()
    expect(lifecycle.terminal()).toBe(false)
    lifecycle.markTerminal()
    expect(lifecycle.terminal()).toBe(true)
    lifecycle.markTerminal()
    expect(lifecycle.terminal()).toBe(true)
  })

  test("pre-session timeout commits the terminal guard alongside the early result", () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(calls.earlyResults).toEqual(["timeout"])
      // G6: the early timeout result is a terminal line; later writers
      // (early errors, the result emission, the failure converter) are
      // log-only from here on.
      expect(lifecycle.terminal()).toBe(true)

      const text = makeLifecycle({ isStream: false })
      text.lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(text.calls.timeoutNotices).toBe(1)
      // Text mode commits the same terminal outcome (the stderr notice).
      expect(text.lifecycle.terminal()).toBe(true)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("post-session timeout arms the last-resort exit and it fires with the committed code", () => {
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      const { lifecycle } = makeLifecycle()
      lifecycle.arm()
      lifecycle.markSession()
      vi.advanceTimersByTime(60)
      expect(lifecycle.timedOut()).toBe(true)
      expect(process.exitCode).toBe(124)
      // The bound is armed but has not fired yet.
      expect(exitSpy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(RUN_LAST_RESORT_EXIT_DELAY_MS)
      // G10: a wedged fetch or SSE cannot keep the process alive past the
      // bound; the committed exit code (124) is what the exit carries.
      expect(exitSpy).toHaveBeenCalledTimes(1)
      expect(exitSpy).toHaveBeenCalledWith(124)
    } finally {
      exitSpy.mockRestore()
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("settle clears the last-resort exit so normal shutdown is unbounded", () => {
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      const { lifecycle } = makeLifecycle()
      lifecycle.arm()
      lifecycle.markSession()
      vi.advanceTimersByTime(60)
      // The run body finished inside the bound: settle() disarms the
      // last-resort timer along with the timeout timer.
      lifecycle.settle()
      vi.advanceTimersByTime(RUN_LAST_RESORT_EXIT_DELAY_MS * 2)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("post-session signal arms the last-resort exit with the cancel exit code", () => {
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      const { lifecycle } = makeLifecycle()
      lifecycle.markSession()
      lifecycle.onSignal()
      expect(process.exitCode).toBe(130)
      vi.advanceTimersByTime(RUN_LAST_RESORT_EXIT_DELAY_MS)
      expect(exitSpy).toHaveBeenCalledTimes(1)
      expect(exitSpy).toHaveBeenCalledWith(130)
    } finally {
      exitSpy.mockRestore()
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("pre-session timeout and signal never arm the last-resort exit", () => {
    vi.useFakeTimers()
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      const timeout = makeLifecycle()
      timeout.lifecycle.arm()
      vi.advanceTimersByTime(60)
      expect(timeout.lifecycle.timedOut()).toBe(true)

      const signal = makeLifecycle()
      signal.lifecycle.onSignal()
      expect(signal.lifecycle.cancelled()).toBe(true)

      vi.advanceTimersByTime(RUN_LAST_RESORT_EXIT_DELAY_MS * 2)
      // No server abort was requested (there is no session yet), so no
      // last-resort bound is armed on these paths.
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("terminal emission waits for a pending server abort that resolves later", async () => {
    vi.useFakeTimers()
    try {
      const { lifecycle, calls } = makeLifecycle()
      lifecycle.markSession()
      lifecycle.onSignal()
      expect(calls.serverAborts).toEqual(["cancelled"])

      let release: () => void = () => {}
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      lifecycle.recordServerAbort(pending)

      let done = false
      const awaited = lifecycle.awaitServerAbort().then(() => {
        done = true
      })
      // While the abort request is still in flight, the terminal wait stays
      // pending across timer turns — and settle() from the run body
      // finishing does not neuter it (the handler-return wait must survive
      // settle, or a throw path could still leave the request undelivered).
      await vi.advanceTimersByTimeAsync(250)
      expect(done).toBe(false)
      lifecycle.settle()
      release()
      await awaited
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("a never-resolving server abort is released by its 5 s bound", async () => {
    vi.useFakeTimers()
    try {
      const { lifecycle } = makeLifecycle()
      lifecycle.markSession()
      lifecycle.onSignal()
      lifecycle.recordServerAbort(new Promise<void>(() => {}))

      let done = false
      const awaited = lifecycle.awaitServerAbort().then(() => {
        done = true
      })
      // One millisecond inside the bound the run is still waiting for the
      // delivery; at the bound the wait is released regardless.
      await vi.advanceTimersByTimeAsync(RUN_SERVER_ABORT_BOUND_MS - 1)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await awaited
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
      process.exitCode = undefined
    }
  })

  test("awaitServerAbort returns immediately when no server abort was issued", async () => {
    const { lifecycle } = makeLifecycle()
    // No request was recorded (happy path, or a pre-session cut), so the
    // terminal emission and the handler return never wait.
    await expect(lifecycle.awaitServerAbort()).resolves.toBeUndefined()
  })
})

test("run records every server abort and awaits delivery before the terminal result and handler return", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  // The abort request promise is recorded in the lifecycle instead of being
  // fired and forgotten (F13).
  const assign = src.indexOf("serverAbort = (reason) => {")
  const record = src.indexOf("lifecycle.recordServerAbort(request)", assign)
  expect(assign).toBeGreaterThan(-1)
  expect(record).toBeGreaterThan(assign)

  // The terminal emission (and the non-stream early return behind the same
  // gate) waits for the recorded abort before the result line is written.
  const terminalWait = src.indexOf("await lifecycle.awaitServerAbort()", record)
  const gate = src.indexOf("if (lifecycle.terminal() || !isRunEventStreamFormat(args.format)) return")
  expect(terminalWait).toBeGreaterThan(-1)
  expect(gate).toBeGreaterThan(terminalWait)

  // Throw paths never reach the emission: execute()'s finally settles the
  // run first (F2), then awaits the abort so no return path leaves the
  // request in flight.
  const settle = src.indexOf("lifecycle.settle()", gate)
  const finallyWait = src.indexOf("await lifecycle.awaitServerAbort()", gate)
  expect(settle).toBeGreaterThan(-1)
  expect(finallyWait).toBeGreaterThan(settle)
})

test("isAbortError walks the cause chain and AggregateError.errors arrays", () => {
  const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" })

  // Direct hit and the classic cause chain.
  expect(isAbortError(abortError())).toBe(true)
  expect(isAbortError(new TypeError("fetch failed", { cause: abortError() }))).toBe(true)
  expect(isAbortError(new Error("outer", { cause: new Error("inner", { cause: abortError() }) }))).toBe(true)

  // G2: Promise combinators aggregate their failures in `errors`, not `cause`.
  expect(isAbortError(new AggregateError([abortError()], "all failed"))).toBe(true)
  expect(isAbortError(new AggregateError([new Error("server 500"), abortError()], "all failed"))).toBe(true)
  // An AggregateError wrapping a plain TypeError whose cause is the abort.
  expect(isAbortError(new AggregateError([new TypeError("fetch failed", { cause: abortError() })], "all failed"))).toBe(
    true,
  )

  // Non-abort failures never match, however they are wrapped.
  expect(isAbortError(new Error("boom"))).toBe(false)
  expect(isAbortError(new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") }))).toBe(false)
  expect(isAbortError(new AggregateError([new Error("server 500")], "all failed"))).toBe(false)

  // Cyclic wrapping is safe instead of recursing forever.
  const cyclic = new Error("cyclic")
  cyclic.cause = cyclic
  expect(isAbortError(cyclic)).toBe(false)
  const cyclicAggregate = new AggregateError([], "cyclic")
  cyclicAggregate.errors.push(cyclicAggregate)
  expect(isAbortError(cyclicAggregate)).toBe(false)

  // Non-objects never match.
  expect(isAbortError(undefined)).toBe(false)
  expect(isAbortError("AbortError")).toBe(false)
  expect(isAbortError(null)).toBe(false)
})

test("UI.Style.TEXT_ITALIC is gated like the other style tokens", () => {
  const original = Object.getOwnPropertyDescriptor(process.stderr, "isTTY")
  const hadNoColor = "NO_COLOR" in process.env
  const previousNoColor = process.env.NO_COLOR
  try {
    delete process.env.NO_COLOR
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true })
    expect(UI.Style.TEXT_ITALIC).toBe("\x1b[3m")

    // NO_COLOR set to any value (no-color.org) disables the sequence.
    process.env.NO_COLOR = "1"
    expect(UI.Style.TEXT_ITALIC).toBe("")

    // A non-TTY stderr disables it too, with NO_COLOR unset.
    delete process.env.NO_COLOR
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true })
    expect(UI.Style.TEXT_ITALIC).toBe("")
  } finally {
    if (original) Object.defineProperty(process.stderr, "isTTY", original)
    if (hadNoColor) process.env.NO_COLOR = previousNoColor
    else delete process.env.NO_COLOR
  }
})

test("run --thinking routes italic styling through UI.Style instead of raw escapes", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  // G8: no hardcoded italic/reset escape sequences may remain in run.ts, so
  // NO_COLOR or a non-TTY stderr can never leak raw escapes.
  expect(src).toContain("${UI.Style.TEXT_DIM}${UI.Style.TEXT_ITALIC}${line}${UI.Style.TEXT_NORMAL}")
  expect(src).not.toContain("\\u001b[3m")
  expect(src).not.toContain("\\u001b[0m")
  expect(src).not.toContain("\\x1b[3m")
})

test("run answers permission asks for every session in the run's tree (G1)", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")

  // The tree is seeded from the main session and extended from
  // session.created/session.updated events whose parent is already in it.
  expect(src).toContain("const sessionTree = new Set<string>()")
  expect(src).toContain("sessionTree.add(sessionID)")
  expect(src).toContain('event.type === "session.created" || event.type === "session.updated"')
  expect(src).toContain("sessionTree.has(info.parentID)")
  // Asks match the tree, not the main session id alone; the emitted denial
  // names the asking (child) session.
  expect(src).toContain("if (!sessionTree.has(permission.sessionID)) continue")
  expect(src).toContain("sessionID: permission.sessionID,")
  // Child tool parts are accounted and streamed but never rendered.
  expect(src).toContain("if (!sessionTree.has(part.sessionID)) continue")
  expect(src).toContain("const isMainSession = part.sessionID === sessionID")
  // The one-shot header only fires for the main session's assistant updates:
  // the session filter sits directly before the format check in that branch.
  expect(src).toContain(
    "event.properties.info.sessionID === sessionID &&\n                !isRunEventStreamFormat(args.format)",
  )
  // Rejections after a committed terminal outcome are swallowed (G2/G6).
  expect(src).toContain("if (isOutcomeCommitted()) {")
  expect(src).toContain("lifecycle.terminal() || lifecycle.timedOut() || lifecycle.cancelled()")
})

test("shared CLI failure handler appends the run usage hint and skips full help for run", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/boot.ts"), "utf-8")
  const failStart = src.indexOf(".fail((msg, err) => {")
  const strict = src.indexOf(".strict()", failStart)
  expect(failStart).toBeGreaterThan(-1)
  expect(strict).toBeGreaterThan(failStart)
  const handler = src.slice(failStart, strict)
  expect(handler).toContain("if (isCliUsageFailureMessage(msg)) {")
  expect(handler).toContain("runUsageFailureHint(msg, command)")
  expect(handler).toContain("process.stderr.write(`${hint}\\n`)")
  // Full help is conditional: only non-run commands print it, and the hint
  // lands before any help output. The exit stays 1.
  expect(handler.indexOf("if (hint)")).toBeLessThan(handler.indexOf("cliFailureShowsFullHelp"))
  expect(handler).toContain("process.exit(1)")
})

test("shared CLI failure handler writes usage-failure help to stderr, never stdout", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/boot.ts"), "utf-8")
  const failStart = src.indexOf(".fail((msg, err) => {")
  const strict = src.indexOf(".strict()", failStart)
  expect(failStart).toBeGreaterThan(-1)
  expect(strict).toBeGreaterThan(failStart)
  const handler = src.slice(failStart, strict)

  // The full help is emitted through a stderr print callback, not yargs's
  // `showHelp("log")` (which writes to stdout via console.log), so a scripted
  // caller that mistypes a non-run command gets an empty stdout with exit 1.
  expect(handler).toContain('cli.showHelp((text) => process.stderr.write(text + "\\n"))')
  expect(handler).not.toContain('cli.showHelp("log")')
  // The one-line error and the run hint already target stderr too.
  expect(handler).toContain("process.stderr.write(`${msg}\\n`)")
})

test("shared CLI failure handler gives stream run consumers one structured stdout line (F15)", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/boot.ts"), "utf-8")
  const failStart = src.indexOf(".fail((msg, err) => {")
  const strict = src.indexOf(".strict()", failStart)
  expect(failStart).toBeGreaterThan(-1)
  const handler = src.slice(failStart, strict)

  // A yargs-level usage failure (e.g. `run --format json --timeot 5`) writes
  // one {"type":"error","error":{"code":"usage",...}} stdout line before any
  // stderr prose, so NDJSON consumers are not left stdout-silent.
  const stdoutLine = handler.indexOf("runArgvUsesEventStream(rawArgv)")
  const structured = handler.indexOf('buildRunEarlyErrorEvent("usage", msg)')
  const stderrLine = handler.indexOf("process.stderr.write(`${msg}\\n`)")
  expect(stdoutLine).toBeGreaterThan(-1)
  expect(structured).toBeGreaterThan(stdoutLine)
  expect(stderrLine).toBeGreaterThan(structured)
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
  // Whitespace-normalized: the status call wraps across lines in the source.
  expect(src.replace(/\s+/g, " ")).toContain(
    "resolveRunResultStatus({ failed: runFailed, blocked: runBlocked, timedOut: lifecycle.timedOut(), cancelled: lifecycle.cancelled(), })",
  )
  // The exit-code precedence (1 > 130 > 124 > 3) lives in the lifecycle module.
  expect(src).toContain("const runExitCode = lifecycle.exitCode({ failed: runFailed, blocked: runBlocked })")
  expect(src).toContain("if (runExitCode !== undefined) process.exitCode = runExitCode")
  expect(src).toContain("usage: finalUsage")
  // G6: the single-writer rule is structural — the result emission consults
  // and sets the lifecycle's terminal guard instead of a local flag.
  expect(src).toContain("if (lifecycle.terminal() || !isRunEventStreamFormat(args.format)) return")
  expect(src).toContain("lifecycle.markTerminal()")
  expect(src).not.toContain("resultEmitted")
  // Blocked accounting rides the same loop that emits tool_use events, through
  // the idempotent accounting helper (G3) fed by every session in the tree.
  expect(src).toContain("accountToolCompletion(accounting, part)")
  expect(src).toContain('emit("permission_denied", {')
  // The result write happens after the structured-output wiring, so it is
  // the final stdout line of the run. (The pre-session --timeout emits its own
  // result earlier in the file — E2 — so the search starts at the
  // structured-output wiring.)
  const structured = src.indexOf("await handleRunStructuredOutput(finalText")
  const resultWrite = src.indexOf("buildRunResultEvent({", structured)
  expect(structured).toBeGreaterThan(-1)
  expect(resultWrite).toBeGreaterThan(structured)
})

test("run accepts the steering flags as long-only kebab-case options", async () => {
  const parsed = await parseRunArgv([
    "--append-system-prompt",
    "Be terse",
    "--disallowed-tools",
    "bash,write",
    "--disallowed-tools",
    "read",
    "--add-dir",
    "/tmp/agent-a",
    "--add-dir",
    "/tmp/agent-b",
    "hello",
  ])
  expect(parsed["append-system-prompt"]).toBe("Be terse")
  // Repeatable values stay in order; comma splitting happens in the handler.
  expect(parsed["disallowed-tools"]).toEqual(["bash,write", "read"])
  expect(parsed["add-dir"]).toEqual(["/tmp/agent-a", "/tmp/agent-b"])

  const fileVariant = await parseRunArgv(["--append-system-prompt-file", "./extra.txt", "hello"])
  expect(fileVariant["append-system-prompt-file"]).toBe("./extra.txt")

  // `--prompt-file=-` is the spelling yargs parses to the literal "-"; the
  // spaced `--prompt-file -` form parses to an empty string (yargs drops the
  // lone dash token), and the handler treats both as the stdin sentinel.
  const stdinVariant = await parseRunArgv(["--prompt-file=-", "hello"])
  expect(stdinVariant["prompt-file"]).toBe("-")
  const spacedVariant = await parseRunArgv(["--prompt-file", "-", "hello"])
  expect(spacedVariant["prompt-file"]).toBe("")
  expect(spacedVariant.message).toEqual(["hello"])

  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  expect(src).toContain('if (promptFileFlag === "-" || promptFileFlag === "")')
})

test("run --append-system-prompt and --append-system-prompt-file are mutually exclusive", async () => {
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
        message: ["hello"],
        "append-system-prompt": "extra",
        "append-system-prompt-file": "extra.txt",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      type: "error",
      error: {
        code: "usage",
        message: "--append-system-prompt and --append-system-prompt-file are mutually exclusive",
      },
    })
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run rejects empty --append-system-prompt text and empty --disallowed-tools values", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.cwd()
  process.chdir(tmp.path)
  const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any)
  try {
    await expect(
      RunCommand.handler({
        message: ["hello"],
        "append-system-prompt": "",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    await expect(
      RunCommand.handler({
        message: ["hello"],
        "disallowed-tools": [","],
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run rejects a --add-dir path that is missing or not a directory", async () => {
  await using tmp = await tmpdir({ git: true })
  await writeFile(path.join(tmp.path, "plain.txt"), "not a dir")
  const previous = process.cwd()
  process.chdir(tmp.path)
  const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any)
  try {
    await expect(
      RunCommand.handler({
        message: ["hello"],
        "add-dir": ["does-not-exist"],
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    await expect(
      RunCommand.handler({
        message: ["hello"],
        "add-dir": ["plain.txt"],
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run --add-dir does not widen --file containment", async () => {
  // The server denies any attachment outside the project directory
  // regardless of permission rules, so a --file under an --add-dir path is a
  // usage error up front, not an accepted run the server would sideline.
  await using tmp = await tmpdir({ git: true })
  await using outside = await tmpdir()
  const outsideFile = path.join(outside.path, "spec.md")
  await writeFile(outsideFile, "spec")
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
        message: ["hello"],
        "add-dir": [outside.path],
        file: [outsideFile],
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event.error.code).toBe("usage")
    expect(event.error.message).toBe(
      `File outside the current project directory: ${outsideFile}. ` +
        "Copy it into the project or pass its content with --prompt-file.",
    )
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run --prompt-file - is a usage error when stdin is a TTY", async () => {
  await using tmp = await tmpdir({ git: true })
  const previous = process.cwd()
  process.chdir(tmp.path)
  let output = ""
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as any)
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
  try {
    await expect(
      RunCommand.handler({
        message: [],
        "prompt-file": "-",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event.error.code).toBe("usage")
    expect(event.error.message).toContain("--prompt-file - requires the prompt on piped stdin")
  } finally {
    // Restore the original descriptor (vitest stdin is typically not a TTY).
    if (originalIsTTY) Object.defineProperty(process.stdin, "isTTY", originalIsTTY)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run arms the timeout before the first SDK call and prints the session id in the header", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run.ts"), "utf-8")
  const lifecycleSrc = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/run-lifecycle.ts"), "utf-8")

  // E2: the timer is armed (handler body) before the event subscription (the
  // first SDK call inside executeRun), so a black-holed attach host is bounded.
  const armed = src.indexOf("lifecycle.arm()")
  const subscribe = src.indexOf("const events = await sdk.event.subscribe")
  expect(armed).toBeGreaterThan(-1)
  expect(subscribe).toBeGreaterThan(armed)
  // A pre-session firing emits the terminal result with an empty session id
  // and cuts the pending SDK calls via the shared lifecycle signal; a
  // post-session firing routes through the server abort first. The signal's
  // pre-session branch shares the same early-result callback with its own
  // status.
  expect(src).toContain("abortState.earlyTimeoutEmitted = true")
  expect(lifecycleSrc).toContain('input.onServerAbort("timeout")')
  expect(lifecycleSrc).toContain('input.onEarlyResult("timeout")')
  expect(lifecycleSrc).toContain('input.onEarlyResult("cancelled")')
  expect(lifecycleSrc).toContain("controller.abort()")
  expect(src).toContain("AbortSignal.any([eventAbort.signal, lifecycle.signal])")

  // E4: the default-format header ends with the session id so multi-turn
  // callers can resume without --format json.
  expect(src).toContain("modelID} · ${sessionID}`)")

  // B3: --add-dir only widens tool permissions — never --file containment,
  // which the server enforces against the project directory regardless of
  // permission rules.
  expect(src).not.toContain("addDirPaths.some((dir) => Filesystem.contains(dir, resolvedPath))")
  expect(src).toContain("if (!Filesystem.contains(fileBaseDir, resolvedPath)) {")

  // B1: the appended system prompt is sent as the request `system` field.
  expect(src).toContain("...(appendSystemPrompt !== undefined ? { system: appendSystemPrompt } : {})")
  // B2/F4: both mechanisms — create-time deny rules and the per-request tools
  // map, which always disables the interactive question/plan_exit tools and
  // merges in --disallowed-tools.
  expect(src).toContain(
    "const promptTools: Record<string, false> = { question: false, plan_exit: false, ...disallowedTools }",
  )
  expect(src).toContain("tools: promptTools")
  // E1: the sandbox policy rides every prompt body, tightening attach runs.
  expect(src).toContain("...(isolationPolicy !== undefined ? { isolation: isolationPolicy } : {})")
  // B4: the parsed schema is sent as the json_schema output format.
  expect(src).toContain("...(outputFormat !== undefined ? { format: outputFormat } : {})")
})

test("run --runtime and --attach are mutually exclusive", async () => {
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
        message: ["hello"],
        runtime: true,
        attach: "http://127.0.0.1:4096",
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      type: "error",
      error: { code: "usage", message: "--runtime and --attach are mutually exclusive" },
    })
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})

test("run --runtime exits with an attach error when no managed runtime is running", async () => {
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
        message: ["hello"],
        runtime: true,
        command: false,
        "--": [],
        format: "json",
      } as never),
    ).rejects.toThrow()
    expect(process.exitCode).toBe(1)

    const lines = output.split("\n").filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      type: "error",
      error: {
        code: "attach",
        message:
          "No running managed runtime for /tmp/ax-code-project. " +
          "Start one with `ax-code runtime start --dir /tmp/ax-code-project`.",
      },
    })
  } finally {
    write.mockRestore()
    process.chdir(previous)
    process.exitCode = undefined
  }
})
