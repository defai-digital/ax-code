// AX Code product-screen golden-frame gate.
//
// script/check-golden-frames.ts guards the renderer with synthetic scenes and
// script/check-tui-snapshot.ts guards tokens and glyphs. Neither renders a real
// product screen, so regressions in the screens users actually see (raw
// markdown in finished replies, tool rows vanishing from the transcript, a
// wrong selection fill, 80x24 truncation) passed both. This gate mounts the
// real AX Code TUI components through the native renderer (node:ffi -> Zig
// core) and compares each scene against a committed golden that stores the
// character grid AND a per-row colour signature (runs of fg/bg/attributes), so
// both layout and colour drift fail.
//
// What is real: every rendered component (DialogCommand/DialogSelect with the
// real app command list, DialogModel, the session transcript UserMessage /
// AssistantMessage / tool renderers / SessionCodeRenderer with tree-sitter,
// PermissionPrompt, Home), the provider stack (KV, Toast, Route, TuiConfig,
// SDK, Language, Theme, Local, Keybind, PromptStash, Dialog, Command,
// Frecency, PromptHistory, PromptRef, VisualCapability), themes, keybinds,
// i18n, and layout.
//
// What is stubbed: the Sync context only. A module resolve hook swaps
// `useSync()` for a fixture built from the real `createInitialSyncState()` and
// the real `createSyncContextValue()`, so nothing bootstraps over HTTP. The SDK
// gets an offline `fetch` that answers every request with an empty 404 and an
// event source that never emits. The session route shell (top bar, sidebar,
// prompt) is not mounted for the transcript scenes; the transcript components
// are mounted in a box that mirrors the route's padding and scrollbox.
//
// Determinism: isolated XDG dirs with a pre-written kv.json (animations off,
// theme axcode, locale en), TZ=UTC, fixed TERM, inherited AX_CODE_* variables
// removed, fixture timestamps, and a scene is captured only after its frame and
// colour signature are unchanged across consecutive polls.
//
// Usage:
//   pnpm --dir packages/ax-code run check:product-frames                 # compare
//   pnpm --dir packages/ax-code run check:product-frames --update        # regenerate
//   pnpm --dir packages/ax-code run check:product-frames --scene=<name>  # one scene
//   pnpm --dir packages/ax-code run check:product-frames --print         # print frames

import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { writeSync } from "node:fs"

const SNAPSHOT_DIR = path.resolve(import.meta.dirname, "../test/cli/tui/__snapshots__/product-frames")

// ---------------------------------------------------------------------------
// Environment isolation (before any app module loads).

// The prepared native cache (CI's verified offline download) is kept; every
// other inherited AX_CODE_* / OPENCODE_* variable is dropped.
const KEEP_ENV = new Set(["AX_CODE_TUI_NATIVE_CACHE_DIR", "AX_CODE_TUI_NATIVE_OFFLINE"])
for (const key of Object.keys(process.env)) {
  if (KEEP_ENV.has(key)) continue
  if (key.startsWith("AX_CODE_") || key.startsWith("OPENCODE_")) delete process.env[key]
}
const state = await fsp.mkdtemp(path.join(os.tmpdir(), "ax-code-product-frames-"))
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
// Installation.VERSION prefers the build-time AX_CODE_VERSION global and falls
// back to package.json in source mode. Pin it so footers that show the version
// do not drift on every release bump.
;(globalThis as { AX_CODE_VERSION?: string }).AX_CODE_VERSION = "local"

// ---------------------------------------------------------------------------
// Sync stub: every importer of src/cli/tui/context/sync.tsx gets a module that
// re-exports the real one but resolves `useSync()` to the scene fixture.

const SYNC_MODULE = pathToFileURL(path.resolve(import.meta.dirname, "../src/cli/tui/context/sync.tsx")).href
const STUB_QUERY = "?product-frames-stub"
const REAL_QUERY = "?product-frames-real"
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
          `  const value = globalThis.__AX_PRODUCT_FRAMES_SYNC__`,
          `  if (!value) throw new Error("product-frames: no sync fixture installed")`,
          `  return value`,
          `}`,
        ].join("\n"),
      }
    }
    return nextLoad(url, context)
  },
})

// Seeded Math.random, reset per scene: the prompt placeholder is picked at
// random, and every other random choice must be repeatable too.
function seedRandom(seed: number) {
  let value = seed >>> 0
  Math.random = () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function writeKV(values: Record<string, unknown>) {
  const dir = path.join(process.env.XDG_STATE_HOME!, "ax-code")
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, "kv.json"), JSON.stringify(values, null, 2))
}
const BASE_KV = {
  animations_enabled: false,
  theme: "axcode",
  interface_language: "en",
  conversation_language: "auto",
  digital_code_on_start: false,
  setup_language_done_v1: true,
  home_examples_dismissed: false,
}
await writeKV(BASE_KV)

const { testRender } = await import("ax-tui/solid")
const { createStore } = await import("solid-js/store")
const { onMount, createSignal, Show } = await import("solid-js")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { ToastProvider, useToast } = await import("../src/cli/tui/ui/toast")
const { RouteProvider, useRoute } = await import("../src/cli/tui/context/route")
const { ArgsProvider } = await import("../src/cli/tui/context/args")
const { ExitProvider } = await import("../src/cli/tui/context/exit")
const { TuiConfigProvider, useTuiConfig } = await import("../src/cli/tui/context/tui-config")
const { SDKProvider, useSDK } = await import("../src/cli/tui/context/sdk")
const { LanguageProvider, useLanguage } = await import("../src/cli/tui/context/language")
const { ThemeProvider, useTheme } = await import("../src/cli/tui/context/theme")
const { LocalProvider, useLocal } = await import("../src/cli/tui/context/local")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { PromptStashProvider } = await import("../src/cli/tui/component/prompt/stash")
const { AxEngineDownloadsProvider } = await import("../src/cli/tui/context/ax-engine-downloads")
const { DialogProvider, DialogStack, useDialog } = await import("../src/cli/tui/ui/dialog")
const { CommandProvider, useCommandDialog } = await import("../src/cli/tui/component/dialog-command")
const { FrecencyProvider } = await import("../src/cli/tui/component/prompt/frecency")
const { PromptHistoryProvider } = await import("../src/cli/tui/component/prompt/history")
const { PromptRefProvider, usePromptRef } = await import("../src/cli/tui/context/prompt")
const { VisualCapabilityProvider } = await import("../src/cli/tui/ui/primitives/capability-context")
const { createInitialSyncState } = await import("../src/cli/tui/context/sync-state")
const { createSyncContextValue } = await import("../src/cli/tui/context/sync-result")
const { SessionRouteContext } = await import("../src/cli/tui/routes/session/context")
const { UserMessage, AssistantMessage } = await import("../src/cli/tui/routes/session/transcript")
const { PermissionPrompt } = await import("../src/cli/tui/routes/session/permission")
const { TranscriptHistoryNotice } = await import("../src/cli/tui/routes/session/transcript-history-notice")
const { TranscriptFollowIndicator } = await import("../src/cli/tui/routes/session/transcript-follow-indicator")
const { updateTranscriptFollow } = await import("../src/cli/tui/routes/session/transcript-follow")
const { DialogModel } = await import("../src/cli/tui/component/dialog-model")
const { Home } = await import("../src/cli/tui/routes/home")
const { appCommands } = await import("../src/cli/tui/app-commands")
const { createTuiDialogLoaders } = await import("../src/cli/tui/tui-dialogs")

import type { JSX } from "solid-js"
import type { CapturedFrame, RGBA, ScrollBoxRenderable } from "ax-tui"
import type { TestRendererSetup } from "ax-tui/testing"
import type { SyncStoreState } from "../src/cli/tui/context/sync-state"
import type {
  Agent,
  AssistantMessage as AssistantMessageInfo,
  Model,
  Part,
  PermissionRequest,
  Provider,
  UserMessage as UserMessageInfo,
} from "@ax-code/sdk/v2"

// ---------------------------------------------------------------------------
// Fixtures.

const SESSION_ID = "ses_product_frames"
// A fixed fake workspace so machine paths never reach a golden. Tool inputs use
// paths relative to process.cwd(), which the renderers print relative.
const DIRECTORY = "/workspace/demo"
const T0 = Date.UTC(2026, 0, 15, 9, 30, 0)

function agent(name: string, extra: Partial<Agent> = {}): Agent {
  return { name, mode: "primary", native: true, tier: "core", permission: [], options: {}, ...extra } as Agent
}
const AGENTS: Agent[] = [agent("build"), agent("plan"), agent("general", { mode: "subagent", tier: "subagent" })]

function model(providerID: string, id: string, name: string, extra: Partial<Model> = {}): Model {
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
    ...extra,
  }
}
function provider(id: string, name: string, models: Model[]): Provider {
  return { id, name, source: "config", env: [], options: {}, models: Object.fromEntries(models.map((m) => [m.id, m])) }
}
const PROVIDERS: Provider[] = [
  provider("acme", "Acme Cloud", [
    model("acme", "acme-coder-large", "Acme Coder Large"),
    model("acme", "acme-coder-small", "Acme Coder Small"),
    model("acme", "acme-reasoner-pro", "Acme Reasoner Pro"),
  ]),
  provider("local", "Local Gateway", [
    model(
      "local",
      "qwen3-coder-480b-a35b-instruct-fp8-long-context",
      "Qwen3 Coder 480B A35B Instruct FP8 Long Context Experimental Preview Build",
    ),
    model("local", "glm-4.6", "GLM 4.6"),
    model("local", "deepseek-v3.2-exp", "DeepSeek V3.2 Exp"),
  ]),
]

const userMessage: UserMessageInfo = {
  id: "msg_0001_user",
  sessionID: SESSION_ID,
  role: "user",
  time: { created: T0 },
  agent: "build",
  model: { providerID: "acme", modelID: "acme-coder-large" },
}

function assistant(id: string, finish: string, created: number, completed?: number): AssistantMessageInfo {
  return {
    id,
    sessionID: SESSION_ID,
    role: "assistant",
    time: { created, completed },
    parentID: userMessage.id,
    modelID: "acme-coder-large",
    providerID: "acme",
    mode: "build",
    agent: "build",
    path: { cwd: DIRECTORY, root: DIRECTORY },
    tokens: { input: 1200, output: 340, reasoning: 0, cache: { read: 0, write: 0 } },
    finish,
  } as AssistantMessageInfo
}
const stepMessage = assistant("msg_0002_step", "tool-calls", T0 + 1_000, T0 + 9_000)
const replyMessage = assistant("msg_0003_reply", "stop", T0 + 9_500, T0 + 14_200)

const GREET_DIFF = [
  "Index: src/util/greet.ts",
  "===================================================================",
  "--- src/util/greet.ts",
  "+++ src/util/greet.ts",
  "@@ -1,2 +1,4 @@",
  ' export const DEFAULT_NAME = "world"',
  '-export const greeting = "hi"',
  "+export function greet(name: string = DEFAULT_NAME): string {",
  "+  return `Hello, ${name}!`",
  "+}",
  "",
].join("\n")

const REPLY_MARKDOWN = [
  "## Added `greet`",
  "",
  "The helper lives in `src/util/greet.ts` and returns a **friendly** string:",
  "",
  "```ts",
  "export function greet(name: string = DEFAULT_NAME): string {",
  "  return `Hello, ${name}!`",
  "}",
  "```",
  "",
  'Call it as `greet("Ada")`; both tests pass.',
].join("\n")

function toolPart(
  messageID: string,
  callID: string,
  tool: string,
  input: Record<string, unknown>,
  output: string,
  metadata: Record<string, unknown>,
  start: number,
): Part {
  return {
    id: `prt_${callID}`,
    sessionID: SESSION_ID,
    messageID,
    type: "tool",
    callID,
    tool,
    state: { status: "completed", input, output, title: tool, metadata, time: { start, end: start + 400 } },
  } as Part
}

const TRANSCRIPT_PARTS: Record<string, Part[]> = {
  [userMessage.id]: [
    {
      id: "prt_0001_text",
      sessionID: SESSION_ID,
      messageID: userMessage.id,
      type: "text",
      text: "Replace the greeting constant in src/util/greet.ts with a greet() helper and run its tests.",
    } as Part,
  ],
  [stepMessage.id]: [
    {
      id: "prt_0002_reasoning",
      sessionID: SESSION_ID,
      messageID: stepMessage.id,
      type: "reasoning",
      text: "Read the module first, then run the existing test before editing.",
      time: { start: T0 + 1_100, end: T0 + 1_900 },
    } as Part,
    toolPart(stepMessage.id, "call_read", "read", { filePath: "src/util/greet.ts" }, "...", {}, T0 + 2_000),
    toolPart(
      stepMessage.id,
      "call_bash",
      "bash",
      { command: "pnpm vitest run test/greet.test.ts", description: "Run greet tests" },
      "",
      {
        output: [
          " ✓ test/greet.test.ts (2 tests) 4ms",
          "",
          " Test Files  1 passed (1)",
          "      Tests  2 passed (2)",
        ].join("\n"),
        exit: 0,
      },
      T0 + 3_000,
    ),
    toolPart(
      stepMessage.id,
      "call_edit",
      "edit",
      { filePath: "src/util/greet.ts", oldString: 'export const greeting = "hi"', newString: "export function greet" },
      "Edit applied successfully.",
      { diff: GREET_DIFF, diagnostics: {} },
      T0 + 6_000,
    ),
  ],
  [replyMessage.id]: [
    {
      id: "prt_0003_text",
      sessionID: SESSION_ID,
      messageID: replyMessage.id,
      type: "text",
      text: REPLY_MARKDOWN,
      time: { start: T0 + 9_600, end: T0 + 14_100 },
    } as Part,
  ],
}

// Permission scene: the step is still running its bash call.
const pendingStep = assistant("msg_0002_step", "", T0 + 1_000)
delete (pendingStep as { finish?: string }).finish
const PERMISSION_PARTS: Record<string, Part[]> = {
  [userMessage.id]: TRANSCRIPT_PARTS[userMessage.id],
  [pendingStep.id]: [
    {
      id: "prt_0004_bash",
      sessionID: SESSION_ID,
      messageID: pendingStep.id,
      type: "tool",
      callID: "call_clean",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "rm -rf dist && pnpm build", description: "Clean and rebuild the package" },
        time: { start: T0 + 2_000 },
      },
    } as Part,
  ],
}
const PERMISSION_REQUEST: PermissionRequest = {
  id: "per_product_frames",
  sessionID: SESSION_ID,
  permission: "bash",
  patterns: ["rm -rf dist && pnpm build"],
  metadata: {},
  always: ["rm *"],
  tool: { messageID: pendingStep.id, callID: "call_clean" },
}

type SyncFixture = (draft: SyncStoreState) => void

function baseSync(draft: SyncStoreState) {
  draft.status = "complete"
  draft.session_loaded = true
  draft.stream_health = "connected"
  draft.agent = AGENTS
  draft.provider = PROVIDERS
  draft.provider_loaded = true
  draft.provider_default = { acme: "acme-coder-large" }
  draft.provider_next = { all: PROVIDERS, default: { acme: "acme-coder-large" }, connected: ["acme", "local"] } as any
  draft.config = { model: "acme/acme-coder-large" } as any
  draft.path = { home: "/home/dev", state: "", config: "", worktree: DIRECTORY, directory: DIRECTORY }
  draft.isolation = { mode: "workspace-write", network: false } as any
}

function installSync(fixture?: SyncFixture) {
  const initial = createInitialSyncState()
  baseSync(initial)
  fixture?.(initial)
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
  ;(globalThis as { __AX_PRODUCT_FRAMES_SYNC__?: unknown }).__AX_PRODUCT_FRAMES_SYNC__ = value
  return value
}

// Offline SDK transport: nothing leaves the process.
// Requests the mounted components make on their own; answered with the empty
// state a fresh project returns. Anything else gets a 404 and is reported by
// --print so a new request path is noticed.
const OFFLINE_ROUTES: Record<string, unknown> = {
  "GET /prompt-history": [],
  "GET /provider/ax-engine/downloads": [],
  "GET /permission/auto-accept": { enabled: false, managedDisabled: false, directory: DIRECTORY },
}
const unexpectedRequests = new Set<string>()
const offlineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : undefined
  const url = new URL(request ? request.url : String(input))
  const key = `${(init?.method ?? request?.method ?? "GET").toUpperCase()} ${url.pathname}`
  const json = { "content-type": "application/json" }
  if (Object.hasOwn(OFFLINE_ROUTES, key))
    return new Response(JSON.stringify(OFFLINE_ROUTES[key]), { status: 200, headers: json })
  unexpectedRequests.add(key)
  return new Response(JSON.stringify({}), { status: 404, headers: json })
}) as typeof fetch
const silentEvents = { on: () => () => {} }

// ---------------------------------------------------------------------------
// Provider tree mirroring app.tsx (SyncProvider omitted: the stub supplies it).

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

// ---------------------------------------------------------------------------
// Scene bodies.

/** Registers the real app command list and opens the command palette. */
function CommandPalette() {
  const command = useCommandDialog()
  const dialog = useDialog()
  const kv = useKV()
  const local = useLocal()
  const toast = useToast()
  const sdk = useSDK()
  const route = useRoute()
  const promptRef = usePromptRef()
  const theme = useTheme()
  const { t } = useLanguage()
  const sync = (globalThis as { __AX_PRODUCT_FRAMES_SYNC__?: any }).__AX_PRODUCT_FRAMES_SYNC__
  const noop = () => {}
  command.register(() =>
    appCommands({
      t,
      dialogs: createTuiDialogLoaders({
        dialog,
        toast,
        variantCount: () => 0,
        currentModelName: () => "Acme Coder Large",
      }),
      sync,
      kv,
      route,
      promptRef,
      dialog,
      local,
      connected: () => true,
      setMode: theme.setMode,
      mode: () => theme.mode(),
      locked: () => false,
      lock: noop,
      unlock: noop,
      terminalTitleEnabled: () => true,
      setTerminalTitleEnabled: noop,
      renderProfile: {} as any,
      smartLlmToggle: { toggle: noop },
      currentRunMode: () => "normal" as any,
      setRunMode: noop,
      toast,
      sdk,
      putJsonWithTimeout: async () => undefined,
      sandbox: { lastRestricted: undefined, controller: undefined },
      exit: Object.assign(noop, {}),
      renderer: {} as any,
      terminalSuspend: { suspend: noop },
      playDigitalCode: noop,
      playReverseDigitalCode: noop,
      terminalWidth: () => 120,
    }),
  )
  onMount(() => command.show())
  return null
}

function ModelPicker() {
  const dialog = useDialog()
  onMount(() => dialog.replace(() => <DialogModel />))
  return null
}

function sessionContext(width: number, sync: unknown) {
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
    sync: sync as any,
    tui,
  }
}

let transcriptScroll: ScrollBoxRenderable | undefined

/** Mirrors the session route body: padding 1/2 and a bottom-sticky scrollbox. */
function Transcript(props: { width: number; permission?: boolean }) {
  const sync = (globalThis as { __AX_PRODUCT_FRAMES_SYNC__?: any }).__AX_PRODUCT_FRAMES_SYNC__
  const { theme } = useTheme()
  const messages = () => sync.data.message[SESSION_ID] ?? []
  const lastAssistant = () => messages().findLast((m: { role: string }) => m.role === "assistant")
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
        {/* Same scrollbox options as routes/session/index.tsx with the default
            scrollbar_visible=true and a single turn (no timeline rail). */}
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (transcriptScroll = r)}
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
          {messages().map((message: UserMessageInfo | AssistantMessageInfo, index: number) =>
            message.role === "user" ? (
              <UserMessage
                index={index}
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
            ),
          )}
        </scrollbox>
        {props.permission ? <PermissionPrompt request={sync.data.permission[SESSION_ID][0]} /> : null}
      </box>
    </SessionRouteContext.Provider>
  )
}

function transcriptFixture(draft: SyncStoreState) {
  draft.session = [{ id: SESSION_ID, title: "Add greet helper", directory: DIRECTORY } as any]
  draft.message[SESSION_ID] = [userMessage, stepMessage, replyMessage] as any
  draft.part = TRANSCRIPT_PARTS as any
  draft.session_status[SESSION_ID] = { type: "idle" } as any
}

function permissionFixture(draft: SyncStoreState) {
  draft.session = [{ id: SESSION_ID, title: "Clean rebuild", directory: DIRECTORY } as any]
  draft.message[SESSION_ID] = [userMessage, pendingStep] as any
  draft.part = PERMISSION_PARTS as any
  draft.permission[SESSION_ID] = [PERMISSION_REQUEST] as any
  draft.session_status[SESSION_ID] = { type: "busy" } as any
}

// ---------------------------------------------------------------------------
// Scene table.

type Setup = TestRendererSetup
interface Scene {
  name: string
  width: number
  height: number
  mode: "dark" | "light"
  sync?: SyncFixture
  body: (scene: Scene) => JSX.Element
  /** Frame text that must be visible before the scene can settle. */
  expect: string[]
  /** Optional extra readiness predicate over the captured spans. */
  ready?: (frame: CapturedFrame) => boolean
  /** Input to drive after the expected text first appears. */
  drive?: (setup: Setup) => Promise<void>
}

/** Polls until `predicate` holds; false after READY_MS. */
async function waitFor(setup: Setup, predicate: () => boolean) {
  const deadline = performance.now() + READY_MS
  while (!predicate()) {
    if (performance.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    setup.renderer.requestRender()
    await setup.renderOnce()
  }
  return true
}

async function pressDown(setup: Setup, count: number) {
  for (let i = 0; i < count; i++) {
    setup.mockInput.pressArrow("down")
    await setup.flush()
  }
}

function paletteScene(width: number, height: number, mode: "dark" | "light"): Scene {
  return {
    name: `command-palette-${mode}-${width}x${height}`,
    width,
    height,
    mode,
    body: () => <CommandPalette />,
    expect: ["Commands"],
    // Move the selection off the first row so the golden pins the selected
    // row fill against a non-selected neighbour.
    drive: (setup) => pressDown(setup, 2),
  }
}

/**
 * True once the finished reply's code row (the last row holding the snippet;
 * the edit diff above it shows the same line) paints its keyword and name in
 * different colours.
 */
function codeHighlighted(frame: CapturedFrame) {
  const row = frame.lines.findLast((line) =>
    line.spans
      .map((span) => span.text)
      .join("")
      .includes("export function greet"),
  )
  if (!row) return false
  const keyword = row.spans.find((span) => span.text.includes("export"))
  const name = row.spans.find((span) => span.text.includes("greet"))
  return !!keyword && !!name && hex(keyword.fg) !== hex(name.fg)
}

let followFixture: { scroll: ScrollBoxRenderable; sample: (activity?: string) => void; append: () => void }
function FollowTranscript(props: { width: number }) {
  const { theme } = useTheme()
  const [rows, setRows] = createSignal(60)
  const [follow, setFollow] = createSignal({ sessionID: "follow", away: false, unread: false })
  let scroll: ScrollBoxRenderable
  function sample(activity?: string) {
    setFollow((previous) =>
      updateTranscriptFollow(
        previous,
        "follow",
        {
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          viewportHeight: scroll.viewport.height,
        },
        activity,
      ),
    )
  }
  return (
    <box flexGrow={1} backgroundColor={theme.background}>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => {
          scroll = value
          followFixture = { scroll, sample, append: () => setRows((count) => count + 1) }
        }}
        flexGrow={1}
        stickyScroll
        stickyStart="bottom"
      >
        <text>{Array.from({ length: rows() }, (_, i) => `Transcript line ${i + 1}`).join("\n")}</text>
      </scrollbox>
      <Show when={follow().away}>
        <TranscriptFollowIndicator
          unread={follow().unread}
          columns={props.width}
          onReturn={() => {
            scroll.scrollTo(scroll.scrollHeight)
            sample()
          }}
        />
      </Show>
    </box>
  )
}

function followScene(width: number): Scene {
  return {
    name: `transcript-follow-dark-${width}x12`,
    width,
    height: 12,
    mode: "dark",
    body: () => <FollowTranscript width={width} />,
    expect: ["Transcript line 60"],
    drive: async (setup) => {
      followFixture.scroll.scrollTo(10)
      followFixture.sample("follow")
      await setup.flush()
      await setup.renderOnce()
      const before = followFixture.scroll.scrollTop
      followFixture.append()
      await setup.flush()
      await setup.renderOnce()
      if (followFixture.scroll.scrollTop !== before) throw new Error("Live output moved the reading position")
      const frame = setup.captureCharFrame().split("\n")
      const row = frame.findIndex((line) => line.includes("↓"))
      if (row < 0) throw new Error("Transcript return control missing")
      await setup.mockMouse.click(frame[row].indexOf("↓"), row)
      await setup.flush()
      await setup.renderOnce()
      if (setup.captureCharFrame().includes("↓")) throw new Error("Return control did not clear after click")
      followFixture.append()
      await setup.flush()
      await setup.renderOnce()
      if (followFixture.scroll.scrollTop !== followFixture.scroll.scrollHeight - followFixture.scroll.viewport.height)
        throw new Error("Return to bottom did not resume sticky scrolling")
      followFixture.scroll.scrollTo(10)
      followFixture.sample("follow")
    },
  }
}

const SCENES: Scene[] = [
  followScene(80),
  followScene(20),
  paletteScene(80, 24, "dark"),
  paletteScene(80, 24, "light"),
  paletteScene(120, 36, "dark"),
  paletteScene(120, 36, "light"),
  {
    name: "model-picker-dark-80x24",
    width: 80,
    height: 24,
    mode: "dark",
    body: () => <ModelPicker />,
    expect: ["Select model", "Acme Coder Large"],
  },
  {
    name: "transcript-finished-dark-120x36",
    width: 120,
    height: 36,
    mode: "dark",
    sync: transcriptFixture,
    body: (scene) => <Transcript width={scene.width} />,
    expect: ["Added", "greet tests", "Edit src/util/greet.ts"],
    ready: codeHighlighted,
  },
  {
    // The same finished turn scrolled to the top: the user message, reasoning,
    // and read/bash rows the bottom-anchored frame cannot fit.
    name: "transcript-finished-top-dark-120x36",
    width: 120,
    height: 36,
    mode: "dark",
    sync: transcriptFixture,
    body: (scene) => <Transcript width={scene.width} />,
    expect: ["Added", "greet tests", "Edit src/util/greet.ts"],
    drive: async (setup) => {
      // Let the highlight land before scrolling so the scroll offset is
      // applied to the final content height.
      await waitFor(setup, () => codeHighlighted(setup.captureSpans()))
      transcriptScroll?.scrollTo(0)
      await setup.flush()
    },
  },
  {
    name: "transcript-finished-light-120x36",
    width: 120,
    height: 36,
    mode: "light",
    sync: transcriptFixture,
    body: (scene) => <Transcript width={scene.width} />,
    expect: ["Added", "greet tests", "Edit src/util/greet.ts"],
    ready: codeHighlighted,
  },
  {
    name: "home-dark-80x24",
    width: 80,
    height: 24,
    mode: "dark",
    body: () => <Home />,
    expect: ["Acme Coder Large"],
  },
  {
    name: "permission-bash-dark-120x36",
    width: 120,
    height: 36,
    mode: "dark",
    sync: permissionFixture,
    body: (scene) => <Transcript width={scene.width} permission />,
    expect: ["Clean and rebuild the package", "rm -rf dist"],
  },
  {
    name: "history-notice-truncated-dark-80x24",
    width: 80,
    height: 24,
    mode: "dark",
    body: () => <TranscriptHistoryNotice count={100} max={300} loading={false} onLoad={() => {}} />,
    expect: ["Showing the latest 100 messages.", "Load earlier messages"],
  },
  {
    name: "history-notice-loading-dark-80x24",
    width: 80,
    height: 24,
    mode: "dark",
    body: () => <TranscriptHistoryNotice count={100} max={300} loading={true} onLoad={() => {}} />,
    expect: ["Showing the latest 100 messages.", "Loading earlier messages"],
  },
  {
    name: "history-notice-limit-dark-80x24",
    width: 80,
    height: 24,
    mode: "dark",
    body: () => <TranscriptHistoryNotice count={300} max={300} loading={false} onLoad={() => {}} />,
    expect: ["Showing 300 messages, the most this view keeps loaded."],
  },
]

// ---------------------------------------------------------------------------
// Capture and serialisation.

function hex(color: RGBA): string {
  const u8 = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${u8(color.r)}${u8(color.g)}${u8(color.b)}${color.a < 1 ? u8(color.a) : ""}`
}

/** Per row: runs of `fg bg attributes*width`, adjacent equal styles merged. */
function colourSignature(frame: CapturedFrame): string[] {
  return frame.lines.map((line) => {
    const runs: { key: string; width: number }[] = []
    for (const span of line.spans) {
      const key = `${hex(span.fg)} ${hex(span.bg)} ${span.attributes}`
      const last = runs.at(-1)
      if (last && last.key === key) last.width += span.width
      else runs.push({ key, width: span.width })
    }
    return runs.map((run) => `${run.key}*${run.width}`).join(" | ")
  })
}

function snapshot(scene: Scene, setup: Setup) {
  const frame = setup.captureSpans()
  return {
    scene: scene.name,
    width: scene.width,
    height: scene.height,
    mode: scene.mode,
    cursor: { col: frame.cursor[0], row: frame.cursor[1] },
    chars: setup
      .captureCharFrame()
      .split("\n")
      .slice(0, scene.height)
      .map((line) => line.trimEnd()),
    colors: colourSignature(frame),
  }
}

const SETTLE_POLLS = 4
const POLL_MS = 40
const DEADLINE_MS = 30_000
const READY_MS = 10_000

async function renderScene(scene: Scene) {
  await writeKV(BASE_KV)
  seedRandom(0x5eed)
  installSync(scene.sync)
  const setup = await testRender(() => <Providers mode={scene.mode}>{scene.body(scene)}</Providers>, {
    width: scene.width,
    height: scene.height,
  })
  try {
    const started = performance.now()
    const poll = async () => {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      await setup.flush()
      setup.renderer.requestRender()
      await setup.renderOnce()
    }
    while (!kvReady()) {
      if (performance.now() - started > DEADLINE_MS) throw new Error(`${scene.name}: KV never hydrated`)
      await poll()
    }
    const visible = () => {
      const text = setup.captureCharFrame()
      return scene.expect.every((needle) => text.includes(needle))
    }
    while (!visible()) {
      if (performance.now() - started > DEADLINE_MS)
        throw new Error(`${scene.name}: expected text never rendered\n${setup.captureCharFrame()}`)
      await poll()
    }
    if (scene.drive) await scene.drive(setup)
    // A readiness predicate that never holds (say, the reply's code block is
    // no longer highlighted) is a regression, not a hang: give up waiting and
    // let the golden comparison report the drift.
    if (scene.ready && !(await waitFor(setup, () => scene.ready!(setup.captureSpans()))))
      console.warn(`! ${scene.name}: readiness predicate never held; comparing the frame as rendered`)
    let previous = ""
    let stable = 0
    while (stable < SETTLE_POLLS) {
      if (performance.now() - started > DEADLINE_MS)
        throw new Error(`${scene.name}: frame never settled\n${setup.captureCharFrame()}`)
      await poll()
      const current = JSON.stringify(snapshot(scene, setup))
      if (current === previous) stable++
      else stable = 0
      previous = current
    }
    return snapshot(scene, setup)
  } finally {
    setup.renderer.destroy()
  }
}

// ---------------------------------------------------------------------------
// Gate.

function printDiff(expected: ReturnType<typeof snapshot>, actual: ReturnType<typeof snapshot>) {
  let shown = 0
  for (const key of ["chars", "colors"] as const) {
    const rows = Math.max(expected[key].length, actual[key].length)
    for (let row = 0; row < rows && shown < 8; row++) {
      if (expected[key][row] === actual[key][row]) continue
      console.error(`  ${key} row ${row}:${key === "colors" ? ` |${actual.chars[row] ?? ""}|` : ""}`)
      console.error(`    golden |${expected[key][row] ?? "<missing>"}|`)
      console.error(`    actual |${actual[key][row] ?? "<missing>"}|`)
      shown++
    }
  }
  if (shown === 0) console.error("  (rows match; the cursor or metadata differs)")
}

const update = process.argv.includes("--update")
const print = process.argv.includes("--print")
const sceneFilter = process.argv.find((arg) => arg.startsWith("--scene="))?.slice("--scene=".length)
const selected = sceneFilter ? SCENES.filter((scene) => scene.name === sceneFilter) : SCENES

let failures = 0
const begin = performance.now()
try {
  if (selected.length === 0) {
    console.error(`Unknown scene: ${sceneFilter}. Scenes: ${SCENES.map((scene) => scene.name).join(", ")}`)
    failures++
  }
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  for (const scene of selected) {
    const actual = await renderScene(scene)
    if (print) writeSync(1, `--- ${scene.name}\n${actual.chars.join("\n")}\n`)
    if (unexpectedRequests.size > 0) {
      // A new request path means the scene rendered against a 404 fallback, so
      // the frame may not show what users see. Stub the route in OFFLINE_ROUTES.
      console.error(`✗ ${scene.name}: unanswered offline requests: ${[...unexpectedRequests].sort().join(", ")}`)
      unexpectedRequests.clear()
      failures++
    }
    const goldenPath = path.join(SNAPSHOT_DIR, `${scene.name}.json`)
    if (update) {
      await fsp.writeFile(goldenPath, JSON.stringify(actual, null, 2) + "\n")
      console.log(`updated ${scene.name}`)
      continue
    }
    if (!fs.existsSync(goldenPath)) {
      console.error(`✗ ${scene.name}: golden missing (run with --update)`)
      failures++
      continue
    }
    const expected = JSON.parse(await fsp.readFile(goldenPath, "utf8")) as ReturnType<typeof snapshot>
    if (JSON.stringify(expected) === JSON.stringify(actual)) {
      console.log(`✓ ${scene.name}`)
      continue
    }
    console.error(`✗ ${scene.name}: frame drift`)
    printDiff(expected, actual)
    failures++
  }
  if (!sceneFilter) {
    const known = new Set(SCENES.map((scene) => `${scene.name}.json`))
    for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
      if (!file.endsWith(".json") || known.has(file)) continue
      if (update) {
        fs.rmSync(path.join(SNAPSHOT_DIR, file))
        console.log(`removed stray golden ${file}`)
      } else {
        console.error(`✗ stray golden with no scene: ${file} (run --update to remove)`)
        failures++
      }
    }
  }
} finally {
  await fsp.rm(state, { recursive: true, force: true })
}

const seconds = ((performance.now() - begin) / 1000).toFixed(1)
if (failures > 0) {
  console.error(
    `\n${failures} product-frame failure(s) in ${seconds}s. If the drift is intentional, run \`pnpm --dir packages/ax-code run check:product-frames --update\` and review the diff.`,
  )
  process.exit(1)
}
console.log(
  update
    ? `\n${selected.length} product golden(s) written to ${path.relative(process.cwd(), SNAPSHOT_DIR)} in ${seconds}s`
    : `\nall ${selected.length} product frames match (${seconds}s)`,
)
process.exit(0)
