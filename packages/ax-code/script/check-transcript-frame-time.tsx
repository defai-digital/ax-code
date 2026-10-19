// Transcript frame-time measurement for the virtualization decision.
//
// The session route (src/cli/tui/routes/session/index.tsx) renders every
// loaded message inside one <scrollbox> with no virtualization, and the sync
// layer caps a session at MAX_SESSION_MESSAGES = 100
// (src/cli/tui/context/sync.tsx). Before changing that, this script measures
// what a frame actually costs at the cap, using the real UserMessage /
// AssistantMessage components from routes/session/transcript.tsx mounted the
// same way check-product-frames.tsx mounts them (same provider stack, same
// Sync stub, same scrollbox options, 120x40):
//
//   a) cold100Ms - first renderOnce of a fresh 100-message mount, plus five
//      forced re-layout repeats (renderer resize forth and back) reported on
//      their own line. There is no timing gate; the repeats only show how
//      stable the cold number is.
//   b) append100 - 60 streaming appends of ~40 chars to the last assistant
//      text part through the Solid store (the path the live UI uses), each
//      followed by one renderOnce. Appends are paced outside the timed region
//      past STREAM_PAINT_MAX_MS so the stream-paint throttle paints every
//      delta instead of coalescing it, exactly as at live streaming cadence.
//   c) append10 - the same appends with only the last 10 messages mounted, so
//      the 100-vs-10 delta isolates the cost of keeping all 100 mounted.
//
// Fixture content is deterministic (seeded generator, no Math.random, fixed
// timestamps): alternating short user prompts and assistant replies of
// 300-3000 chars of markdown, ~20% of replies with a fenced code block and
// ~30% with a completed bash/read tool part.
//
// The last line of output is a one-line JSON summary:
//   {"cold100Ms":...,"append100":{"median":...,"p95":...,"max":...},"append10":{...}}
// Exit code is 0 on a successful measurement and 1 only on a harness error.
//
// Usage: pnpm --dir packages/ax-code run check:transcript-frame-time

import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Environment isolation (before any app module loads), mirroring
// check-product-frames.tsx so themes, kv, and i18n resolve identically.

// The prepared native cache (CI's verified offline download) is kept; every
// other inherited AX_CODE_* / OPENCODE_* variable is dropped.
const KEEP_ENV = new Set(["AX_CODE_TUI_NATIVE_CACHE_DIR", "AX_CODE_TUI_NATIVE_OFFLINE"])
for (const key of Object.keys(process.env)) {
  if (KEEP_ENV.has(key)) continue
  if (key.startsWith("AX_CODE_") || key.startsWith("OPENCODE_")) delete process.env[key]
}
const state = await fsp.mkdtemp(path.join(os.tmpdir(), "ax-code-transcript-frame-time-"))
process.env.AX_CODE_TEST_HOME = state
process.env.XDG_CONFIG_HOME = path.join(state, "config")
process.env.XDG_DATA_HOME = path.join(state, "data")
process.env.XDG_STATE_HOME = path.join(state, "state")
process.env.XDG_CACHE_HOME = path.join(state, "cache")
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
process.env.TZ = "UTC"
process.env.TERM = "xterm-256color"
process.env.COLORTERM = "truecolor"
delete process.env.TERM_PROGRAM
delete process.env.NO_COLOR
delete process.env.FORCE_COLOR

// ---------------------------------------------------------------------------
// Sync stub: every importer of src/cli/tui/context/sync.tsx gets a module that
// re-exports the real one but resolves useSync() to the fixture installed
// below, so nothing bootstraps over HTTP (same hook as check-product-frames).

const SYNC_MODULE = pathToFileURL(path.resolve(import.meta.dirname, "../src/cli/tui/context/sync.tsx")).href
const STUB_QUERY = "?transcript-frame-time-stub"
const REAL_QUERY = "?transcript-frame-time-real"
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    if (resolved.url === SYNC_MODULE) return { ...resolved, url: SYNC_MODULE + STUB_QUERY, shortCircuit: true }
    return resolved
  },
  load(url, context, nextLoad) {
    if (url === SYNC_MODULE + STUB_QUERY) {
      return {
        format: "module",
        shortCircuit: true,
        source: [
          `export * from ${JSON.stringify(SYNC_MODULE + REAL_QUERY)}`,
          `export function useSync() {`,
          `  const value = globalThis.__AX_TRANSCRIPT_FRAME_TIME_SYNC__`,
          `  if (!value) throw new Error("transcript-frame-time: no sync fixture installed")`,
          `  return value`,
          `}`,
        ].join("\n"),
      }
    }
    return nextLoad(url, context)
  },
})

async function writeKV(values: Record<string, unknown>) {
  const dir = path.join(process.env.XDG_STATE_HOME!, "ax-code")
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, "kv.json"), JSON.stringify(values, null, 2))
}
await writeKV({
  animations_enabled: false,
  theme: "axcode",
  interface_language: "en",
  conversation_language: "auto",
  digital_code_on_start: false,
  setup_language_done_v1: true,
  home_examples_dismissed: false,
})

const { testRender } = await import("ax-tui/solid")
const { createStore, produce } = await import("solid-js/store")
const { For } = await import("solid-js")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { RouteProvider } = await import("../src/cli/tui/context/route")
const { ArgsProvider } = await import("../src/cli/tui/context/args")
const { ExitProvider } = await import("../src/cli/tui/context/exit")
const { TuiConfigProvider, useTuiConfig } = await import("../src/cli/tui/context/tui-config")
const { SDKProvider } = await import("../src/cli/tui/context/sdk")
const { LanguageProvider } = await import("../src/cli/tui/context/language")
const { ThemeProvider, useTheme } = await import("../src/cli/tui/context/theme")
const { LocalProvider } = await import("../src/cli/tui/context/local")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { PromptStashProvider } = await import("../src/cli/tui/component/prompt/stash")
const { AxEngineDownloadsProvider } = await import("../src/cli/tui/context/ax-engine-downloads")
const { DialogProvider, DialogStack } = await import("../src/cli/tui/ui/dialog")
const { CommandProvider } = await import("../src/cli/tui/component/dialog-command")
const { FrecencyProvider } = await import("../src/cli/tui/component/prompt/frecency")
const { PromptHistoryProvider } = await import("../src/cli/tui/component/prompt/history")
const { PromptRefProvider } = await import("../src/cli/tui/context/prompt")
const { VisualCapabilityProvider } = await import("../src/cli/tui/ui/primitives/capability-context")
const { createInitialSyncState } = await import("../src/cli/tui/context/sync-state")
const { createSyncContextValue } = await import("../src/cli/tui/context/sync-result")
const { SessionRouteContext } = await import("../src/cli/tui/routes/session/context")
const { UserMessage, AssistantMessage } = await import("../src/cli/tui/routes/session/transcript")

import type { JSX } from "solid-js"
import type { TestRendererSetup } from "ax-tui/testing"
import type { SyncStoreState } from "../src/cli/tui/context/sync-state"
import type { useSync } from "../src/cli/tui/context/sync"
import type {
  Agent,
  AssistantMessage as AssistantMessageInfo,
  Message,
  Model,
  Part,
  Provider,
  UserMessage as UserMessageInfo,
} from "@ax-code/sdk/v2"

type SyncContextValue = ReturnType<typeof useSync>

// ---------------------------------------------------------------------------
// Fixtures. One full 100-message session is generated once; a smaller mount
// slices the tail so the streaming target (the last assistant reply) is byte
// identical in both mounts and only the mounted context differs.

const SESSION_ID = "ses_transcript_frame_time"
const DIRECTORY = "/workspace/demo"
const T0 = Date.UTC(2026, 0, 15, 9, 30, 0)
const WIDTH = 120
const HEIGHT = 40
const FULL_COUNT = 100
const SMALL_COUNT = 10
const APPEND_ITERATIONS = 60
const APPEND_CHUNK_CHARS = 40
// One tick past STREAM_PAINT_MAX_MS (stream-paint.ts) so every paced append
// takes the throttle's paint-now path instead of being coalesced.
const APPEND_PACE_MS = 130

function agent(name: string, mode: "primary" | "subagent"): Agent {
  return { name, mode, native: true, tier: "core", permission: [], options: {} }
}
const AGENTS: Agent[] = [agent("build", "primary"), agent("plan", "primary"), agent("general", "subagent")]

function model(providerID: string, id: string, name: string): Model {
  return {
    id,
    providerID,
    api: { id, url: "https://example.invalid", npm: "@ai-sdk/openai-compatible" },
    name,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 200_000, output: 32_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}
function provider(id: string, name: string, models: Model[]): Provider {
  return { id, name, source: "config", env: [], options: {}, models: Object.fromEntries(models.map((m) => [m.id, m])) }
}
const PROVIDERS: Provider[] = [provider("acme", "Acme Cloud", [model("acme", "acme-coder-large", "Acme Coder Large")])]

// Deterministic word stream (linear congruential generator, fixed seed).
const WORDS = [
  "parser",
  "module",
  "buffer",
  "layout",
  "render",
  "session",
  "transcript",
  "scroll",
  "frame",
  "token",
  "stream",
  "cache",
  "index",
  "query",
  "schema",
  "handler",
  "worker",
  "bundle",
  "runtime",
  "fixture",
  "golden",
  "viewport",
  "cursor",
  "syntax",
  "markdown",
  "fence",
  "delta",
  "paint",
  "store",
  "effect",
]

function createRng(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function sentence(rng: () => number, index: number): string {
  const count = 8 + Math.floor(rng() * 8)
  const words: string[] = []
  for (let i = 0; i < count; i++) words.push(WORDS[Math.floor(rng() * WORDS.length)] ?? "module")
  const text = words.join(" ")
  return `${index % 7 === 0 ? `Step ${index}: ` : ""}${text.charAt(0).toUpperCase()}${text.slice(1)}. `
}

function assistantText(rng: () => number, pair: number, withCode: boolean): string {
  const target = 300 + Math.floor(rng() * 2_701)
  const code = withCode
    ? [
        "```ts",
        `export function handler${pair}(input: string): number {`,
        `  const parsed = input.trim().split("\\n")`,
        `  return parsed.filter((line) => line.length > 0).length + ${pair}`,
        "}",
        "```",
      ].join("\n")
    : ""
  const proseTarget = target - (code ? code.length + 4 : 0)
  let prose = `## Result ${pair}\n\n`
  let step = 0
  while (prose.length < proseTarget) {
    prose += sentence(rng, step)
    step++
    if (step % 5 === 4) prose += "\n\n"
  }
  prose = prose.slice(0, proseTarget).trimEnd()
  if (!code) return prose
  const mid = prose.indexOf("\n\n", 20)
  const head = mid > 0 ? prose.slice(0, mid) : prose.slice(0, Math.floor(prose.length / 2))
  const tail = mid > 0 ? prose.slice(mid) : prose.slice(Math.floor(prose.length / 2))
  return `${head}\n\n${code}\n\n${tail.trimStart()}`
}

interface Fixture {
  messages: Message[]
  parts: Record<string, Part[]>
  lastAssistantID: string
  lastTextPartIndex: number
}

function buildFullFixture(): Fixture {
  const rng = createRng(0x5eed_100)
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}
  for (let pair = 0; pair < FULL_COUNT / 2; pair++) {
    const created = T0 + pair * 20_000
    const user: UserMessageInfo = {
      id: `msg_${String(pair * 2).padStart(4, "0")}_user`,
      sessionID: SESSION_ID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "acme", modelID: "acme-coder-large" },
    }
    const last = pair === FULL_COUNT / 2 - 1
    const assistant: AssistantMessageInfo = {
      id: `msg_${String(pair * 2 + 1).padStart(4, "0")}_assistant`,
      sessionID: SESSION_ID,
      role: "assistant",
      time: last ? { created: created + 1_000 } : { created: created + 1_000, completed: created + 9_000 },
      parentID: user.id,
      modelID: "acme-coder-large",
      providerID: "acme",
      mode: "build",
      agent: "build",
      path: { cwd: DIRECTORY, root: DIRECTORY },
      tokens: { input: 1_200, output: 340, reasoning: 0, cache: { read: 0, write: 0 } },
      ...(last ? {} : { finish: "stop" }),
    }
    messages.push(user, assistant)
    parts[user.id] = [
      {
        id: `prt_${user.id}_text`,
        sessionID: SESSION_ID,
        messageID: user.id,
        type: "text",
        text: `Update module ${pair} in src/feature-${pair}.ts, keep the public API stable, and run its tests.`,
      },
    ]
    // ~20% of replies carry a fenced code block, ~30% a completed tool part.
    const text = assistantText(rng, pair, pair % 5 === 0)
    const reply: Part[] = [
      {
        id: `prt_${assistant.id}_text`,
        sessionID: SESSION_ID,
        messageID: assistant.id,
        type: "text",
        text,
        time: { start: created + 1_100, ...(last ? {} : { end: created + 8_900 }) },
      },
    ]
    if (pair % 10 < 3) {
      const bash = pair % 2 === 0
      reply.push({
        id: `prt_${assistant.id}_tool`,
        sessionID: SESSION_ID,
        messageID: assistant.id,
        type: "tool",
        callID: `call_${pair}`,
        tool: bash ? "bash" : "read",
        state: {
          status: "completed",
          input: bash
            ? { command: `pnpm vitest run test/feature-${pair}.test.ts`, description: `Run feature ${pair} tests` }
            : { filePath: `src/feature-${pair}.ts` },
          output: bash ? "" : `export const feature${pair} = ${pair}\n`,
          title: bash ? "bash" : "read",
          metadata: bash
            ? {
                output: [` ✓ test/feature-${pair}.test.ts (2 tests) 4ms`, "", " Test Files  1 passed (1)"].join("\n"),
                exit: 0,
              }
            : {},
          time: { start: created + 3_000, end: created + 3_400 },
        },
      })
    }
    parts[assistant.id] = reply
  }
  const lastAssistant = messages.at(-1)
  if (!lastAssistant || lastAssistant.role !== "assistant")
    throw new Error("fixture must end with an assistant message")
  return { messages, parts, lastAssistantID: lastAssistant.id, lastTextPartIndex: 0 }
}

const FULL_FIXTURE = buildFullFixture()

function fixtureFor(count: number): Fixture {
  return {
    messages: FULL_FIXTURE.messages.slice(FULL_COUNT - count),
    parts: FULL_FIXTURE.parts,
    lastAssistantID: FULL_FIXTURE.lastAssistantID,
    lastTextPartIndex: FULL_FIXTURE.lastTextPartIndex,
  }
}

// ---------------------------------------------------------------------------
// Sync fixture installation. Each mount gets a fresh Solid store cloned from
// the deterministic fixture; appends mutate that store, which is the same
// store the stubbed useSync() hands to the mounted components.

interface InstalledSync {
  append: (chunk: string) => void
}

function installSync(fixture: Fixture): InstalledSync {
  const initial = createInitialSyncState()
  initial.status = "complete"
  initial.session_loaded = true
  initial.stream_health = "connected"
  initial.agent = AGENTS
  initial.provider = PROVIDERS
  initial.provider_loaded = true
  initial.provider_default = { acme: "acme-coder-large" }
  initial.provider_next = { all: [], default: { acme: "acme-coder-large" }, connected: ["acme"] }
  initial.config = { model: "acme/acme-coder-large" }
  initial.path = { home: "/home/dev", state: "", config: "", worktree: DIRECTORY, directory: DIRECTORY }
  // Clone so appends in one mount cannot leak into the next mount's fixture.
  initial.message[SESSION_ID] = structuredClone(fixture.messages)
  initial.part = structuredClone(fixture.parts)
  initial.session_status[SESSION_ID] = { type: "busy" }
  const [store, setStore] = createStore<SyncStoreState>(initial)
  const value = createSyncContextValue({
    store,
    setStore,
    sessionSync: async () => {},
    sessionClear: () => {},
    workspaceSync: async () => {},
    bootstrap: async () => {},
    runtime: { syncSuperLong: async () => {} },
  })
  const globals = globalThis as unknown as { __AX_TRANSCRIPT_FRAME_TIME_SYNC__?: SyncContextValue }
  globals.__AX_TRANSCRIPT_FRAME_TIME_SYNC__ = value as unknown as SyncContextValue
  return {
    append(chunk: string) {
      setStore(
        produce((draft: SyncStoreState) => {
          const part = draft.part[fixture.lastAssistantID]?.[fixture.lastTextPartIndex]
          if (part?.type === "text") part.text += chunk
        }),
      )
    },
  }
}

function currentSync(): SyncContextValue {
  const globals = globalThis as unknown as { __AX_TRANSCRIPT_FRAME_TIME_SYNC__?: SyncContextValue }
  if (!globals.__AX_TRANSCRIPT_FRAME_TIME_SYNC__) throw new Error("transcript-frame-time: no sync fixture installed")
  return globals.__AX_TRANSCRIPT_FRAME_TIME_SYNC__
}

// Offline SDK transport: nothing leaves the process (same stub as
// check-product-frames.tsx).
const OFFLINE_ROUTES: Record<string, unknown> = {
  "GET /prompt-history": [],
  "GET /provider/ax-engine/downloads": [],
}
const offlineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : undefined
  const url = new URL(request ? request.url : String(input))
  const key = `${(init?.method ?? request?.method ?? "GET").toUpperCase()} ${url.pathname}`
  const json = { "content-type": "application/json" }
  if (Object.hasOwn(OFFLINE_ROUTES, key))
    return new Response(JSON.stringify(OFFLINE_ROUTES[key]), { status: 200, headers: json })
  return new Response(JSON.stringify({}), { status: 404, headers: json })
}) as typeof fetch
const silentEvents = { on: () => () => {} }

// ---------------------------------------------------------------------------
// Provider tree mirroring app.tsx (SyncProvider omitted: the stub supplies
// it), identical to check-product-frames.tsx.

let kvReady = () => false

function KVProbe() {
  const kv = useKV()
  kvReady = () => kv.ready
  return null
}

function Providers(props: { mode: "dark" | "light"; children: JSX.Element }) {
  return (
    <ArgsProvider>
      <ExitProvider onExit={async () => {}}>
        <KVProvider>
          <KVProbe />
          <ToastProvider>
            <RouteProvider>
              <TuiConfigProvider config={{}}>
                <SDKProvider url="http://127.0.0.1:9" directory={DIRECTORY} fetch={offlineFetch} events={silentEvents}>
                  <LanguageProvider>
                    <ThemeProvider mode={props.mode}>
                      <LocalProvider>
                        <KeybindProvider>
                          <PromptStashProvider>
                            <AxEngineDownloadsProvider>
                              <DialogProvider>
                                <CommandProvider>
                                  <FrecencyProvider>
                                    <PromptHistoryProvider>
                                      <PromptRefProvider>
                                        <VisualCapabilityProvider>
                                          <Backdrop>{props.children}</Backdrop>
                                        </VisualCapabilityProvider>
                                      </PromptRefProvider>
                                    </PromptHistoryProvider>
                                  </FrecencyProvider>
                                  <DialogStack />
                                </CommandProvider>
                              </DialogProvider>
                            </AxEngineDownloadsProvider>
                          </PromptStashProvider>
                        </KeybindProvider>
                      </LocalProvider>
                    </ThemeProvider>
                  </LanguageProvider>
                </SDKProvider>
              </TuiConfigProvider>
            </RouteProvider>
          </ToastProvider>
        </KVProvider>
      </ExitProvider>
    </ArgsProvider>
  )
}

/** The app root paints theme.background under every route and dialog. */
function Backdrop(props: { children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column">
      {props.children}
    </box>
  )
}

function sessionContext(width: number, sync: SyncContextValue) {
  const tui = useTuiConfig()
  return {
    width,
    sessionID: SESSION_ID,
    conceal: () => true,
    showThinking: () => true,
    showTimestamps: () => false,
    showDetails: () => true,
    showGenericToolOutput: () => false,
    userMetadataPreference: () => "auto" as const,
    diffWrapMode: () => "word" as const,
    sync,
    tui,
  }
}

/**
 * Mirrors the session route body: the route's padding box and one
 * bottom-sticky scrollbox holding a <For> over every loaded message, rendered
 * by the real UserMessage / AssistantMessage components.
 */
function Transcript(props: { width: number }) {
  const sync = currentSync()
  const { theme } = useTheme()
  const messages = () => sync.data.message[SESSION_ID] ?? []
  const lastAssistant = () => messages().findLast((message) => message.role === "assistant")
  return (
    <SessionRouteContext.Provider value={sessionContext(props.width - 4, sync)}>
      <box
        flexGrow={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
        backgroundColor={theme.background}
      >
        <scrollbox
          viewportOptions={{ paddingRight: 1 }}
          verticalScrollbarOptions={{
            width: 1,
            paddingLeft: 1,
            visible: true,
            trackOptions: { backgroundColor: theme.backgroundElement, foregroundColor: theme.border },
          }}
          stickyScroll={true}
          stickyStart="bottom"
          flexGrow={1}
          minWidth={0}
        >
          <For each={messages()}>
            {(message, index) =>
              message.role === "user" ? (
                <UserMessage
                  index={index()}
                  onMouseUp={() => {}}
                  message={message}
                  parts={sync.data.part[message.id] ?? []}
                />
              ) : (
                <AssistantMessage
                  last={lastAssistant()?.id === message.id}
                  message={message}
                  parts={sync.data.part[message.id] ?? []}
                />
              )
            }
          </For>
        </scrollbox>
      </box>
    </SessionRouteContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Measurement.

interface Stats {
  median: number
  p95: number
  max: number
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1) ?? 0) }
}

function appendChunk(iteration: number): string {
  const base = ` Further detail ${iteration}: the renderer keeps painting.`
  return base.padEnd(APPEND_CHUNK_CHARS, " ").slice(0, APPEND_CHUNK_CHARS)
}

async function settle(setup: TestRendererSetup) {
  // One renderOnce settles layout; further polls only wait for KV hydration
  // and the first painted frame, mirroring check-product-frames.tsx.
  await setup.renderOnce()
  const deadline = performance.now() + 30_000
  while (!kvReady() || setup.captureCharFrame().trim().length === 0) {
    if (performance.now() > deadline) throw new Error("transcript never painted a settled first frame")
    await new Promise((resolve) => setTimeout(resolve, 40))
    setup.renderer.requestRender()
    await setup.renderOnce()
  }
  await setup.flush()
}

async function measureAppends(setup: TestRendererSetup, installed: InstalledSync): Promise<Stats> {
  const samples: number[] = []
  let lastPaintEnd = performance.now()
  for (let iteration = 0; iteration < APPEND_ITERATIONS; iteration++) {
    const wait = APPEND_PACE_MS - (performance.now() - lastPaintEnd)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    const start = performance.now()
    installed.append(appendChunk(iteration))
    setup.renderer.requestRender()
    await setup.renderOnce()
    const end = performance.now()
    samples.push(end - start)
    lastPaintEnd = end
  }
  // Guard the measurement: if the throttle coalesced the appends instead of
  // painting them, the samples above would time near-empty frames.
  if (!setup.captureCharFrame().includes(`Further detail ${APPEND_ITERATIONS - 1}`))
    throw new Error("streamed appends did not reach the painted frame")
  return stats(samples)
}

async function mount(count: number) {
  const installed = installSync(fixtureFor(count))
  const setup = await testRender(() => <Providers mode="dark">{<Transcript width={WIDTH} />}</Providers>, {
    width: WIDTH,
    height: HEIGHT,
  })
  return { setup, installed }
}

let cold100Ms = 0
let append100: Stats | undefined
let append10: Stats | undefined
try {
  // Cold: a fresh 100-message mount, timed on its first renderOnce.
  const full = await mount(FULL_COUNT)
  try {
    const coldStart = performance.now()
    await full.setup.renderOnce()
    cold100Ms = round(performance.now() - coldStart)
    await settle(full.setup)
    if (!full.setup.captureCharFrame().includes("Update module"))
      throw new Error("settled 100-message frame does not contain fixture content")

    // Five forced re-layout repeats: resize forth (untimed settle at the new
    // width) and back (timed), so each sample pays a full Yoga re-layout and
    // rewrap of all 100 messages at 120x40.
    const repeats: number[] = []
    for (let repeat = 0; repeat < 5; repeat++) {
      full.setup.resize(WIDTH - 1, HEIGHT)
      await full.setup.renderOnce()
      full.setup.resize(WIDTH, HEIGHT)
      const start = performance.now()
      await full.setup.renderOnce()
      repeats.push(round(performance.now() - start))
    }
    const repeatStats = stats(repeats)
    console.log(
      `cold repeats (forced re-layout): ${repeats.map((value) => value.toFixed(2)).join(", ")} ms ` +
        `(median ${repeatStats.median.toFixed(2)}, max ${repeatStats.max.toFixed(2)})`,
    )

    // One renderOnce settles layout again at 120x40 before streaming.
    full.setup.renderer.requestRender()
    await full.setup.renderOnce()
    append100 = await measureAppends(full.setup, full.installed)
  } finally {
    full.setup.renderer.destroy()
  }
  console.log(
    `append100: median ${append100.median.toFixed(2)} ms, p95 ${append100.p95.toFixed(2)} ms, max ${append100.max.toFixed(2)} ms`,
  )

  // Comparison: identical streaming target, only the last 10 messages mounted.
  const small = await mount(SMALL_COUNT)
  try {
    await settle(small.setup)
    append10 = await measureAppends(small.setup, small.installed)
  } finally {
    small.setup.renderer.destroy()
  }
  console.log(
    `append10: median ${append10.median.toFixed(2)} ms, p95 ${append10.p95.toFixed(2)} ms, max ${append10.max.toFixed(2)} ms`,
  )

  console.log(JSON.stringify({ cold100Ms, append100, append10 }))
} catch (error) {
  console.error(`transcript-frame-time harness error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await fsp.rm(state, { recursive: true, force: true })
}
