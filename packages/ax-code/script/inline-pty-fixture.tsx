// Real split-footer frontend check. Sync is stubbed; Prompt, providers, surfaces and renderer are real.
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { writeSync } from "node:fs"

import assert from "node:assert/strict"
import z from "zod"
import { createCliRenderer } from "ax-tui"

// ---------------------------------------------------------------------------
// Environment isolation (before any app module loads).

// The prepared native cache (CI's verified offline download) is kept; every
// other inherited AX_CODE_* / OPENCODE_* variable is dropped.
const KEEP_ENV = new Set(["AX_CODE_TUI_NATIVE_CACHE_DIR", "AX_CODE_TUI_NATIVE_OFFLINE"])
for (const key of Object.keys(process.env)) {
  if (KEEP_ENV.has(key)) continue
  if (key.startsWith("AX_CODE_") || key.startsWith("OPENCODE_")) delete process.env[key]
}
const state = await fsp.mkdtemp(path.join(os.tmpdir(), "ax-code-inline-frontend-"))
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
const STUB_QUERY = "?inline-frontend-stub"
const REAL_QUERY = "?inline-frontend-real"
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
          `export function SyncProvider(props) { return props.children }`,
          `export function useSync() {`,
          `  const value = globalThis.__AX_INLINE_SYNC__`,
          `  if (!value) throw new Error("inline-frontend: no sync fixture installed")`,
          `  return value`,
          `}`,
        ].join("\n"),
      }
    }
    return nextLoad(url, context)
  },
})

const { render } = await import("ax-tui/solid")
const { createStore } = await import("solid-js/store")
const { Config } = await import("../src/config/config")
const { InlineRoot } = await import("../src/cli/tui/inline")
const { createTuiRenderOptionsFromProfile, resolveTuiRenderProfile } = await import("../src/cli/tui/renderer")
const { createInitialSyncState } = await import("../src/cli/tui/context/sync-state")
const { createSyncContextValue } = await import("../src/cli/tui/context/sync-result")
import type { Agent, Model, Provider, Message, Part } from "@ax-code/sdk/v2"

function agent(name: string, extra: Partial<Agent> = {}): Agent {
  return { name, mode: "primary", native: true, tier: "core", permission: [], options: {}, ...extra } as Agent
}

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

const sid = "ses_inline"
const initial = createInitialSyncState()
Object.assign(initial, {
  status: "complete",
  session_loaded: true,
  provider_loaded: true,
  stream_health: "connected",
  agent: [agent("build")],
  provider: [provider("acme", "Acme", [model("acme", "coder", "Coder")])],
  provider_default: { acme: "coder" },
  config: { model: "acme/coder" },
  session: [{ id: sid, title: "Inline check", directory: "/workspace/demo", time: { created: 1, updated: 1 } }],
})
const [store, setStore] = createStore(initial)
const sync = createSyncContextValue({
  store,
  setStore,
  sessionSync: async () => {},
  sessionClear: () => {},
  workspaceSync: async () => {},
  bootstrap: async () => {},
  runtime: { syncSuperLong: async () => {} },
})
;(globalThis as { __AX_INLINE_SYNC__?: unknown }).__AX_INLINE_SYNC__ = sync
const kvDir = path.join(process.env.XDG_STATE_HOME!, "ax-code")
await fsp.mkdir(kvDir, { recursive: true })
await fsp.writeFile(
  path.join(kvDir, "kv.json"),
  JSON.stringify({
    animations_enabled: false,
    theme: "axcode",
    interface_language: "en",
    digital_code_on_start: false,
  }),
)
let submittedPrompt = false
const offlineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.pathname.endsWith("/prompt_async")) {
    const body = z
      .object({ parts: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
      .parse(await new Request(input, init).json())
    submittedPrompt = body.parts.some(
      (part) => part.type === "text" && part.text === "PTY user \u4e2d\u6587 \ud83d\ude80",
    )
  }
  const payload = url.pathname === "/permission/auto-accept" ? { enabled: false, managedDisabled: false } : []
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
}) as typeof fetch
// Native terminal IO; no test renderer or mock keyboard in this fixture.
assert(process.stdin.isTTY && process.stdout.isTTY)
const fullScreen = process.argv.includes("--full")
const mark = (name: string) => writeSync(1, `\x1b]777;inline;${name}\x07`)
const input = {
  url: "http://127.0.0.1:9",
  args: { sessionID: sid },
  config: { keybinds: Config.Keybinds.parse({}) },
  directory: "/workspace/demo",
  fetch: offlineFetch,
  events: { on: () => () => {} },
}
if (fullScreen) {
  process.env.AX_CODE_TUI_ADVANCED_TERMINAL = "0"
  const { tui } = await import("../src/cli/tui/app")
  void tui({ ...input, screen: "full" }).then(async () => {
    await fsp.rm(state, { recursive: true, force: true })
    process.exit(0)
  })
} else {
  const profile = resolveTuiRenderProfile({
    advancedTerminal: false,
    terminalTitleDisabled: true,
    screenFlag: "inline",
  })
  const renderer = await createCliRenderer({ ...createTuiRenderOptionsFromProfile(profile), useThread: false })
  await render(
    () => (
      <InlineRoot
        input={input}
        profile={profile}
        onExit={async () => {
          await fsp.rm(state, { recursive: true, force: true })
          process.exit(0)
        }}
      />
    ),
    renderer,
  )
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(test: () => boolean) {
  const deadline = Date.now() + 10000
  while (!test()) {
    assert(Date.now() < deadline, "PTY input did not complete request")
    await delay(20)
  }
}
await delay(300)
mark("draft")
// The driver types a draft and submits; the stub backend does not generate messages.
await waitFor(() => submittedPrompt)
const user = {
  id: "msg_pty1",
  sessionID: sid,
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "acme", modelID: "coder" },
} as Message
const answer = {
  id: "msg_pty2",
  sessionID: sid,
  role: "assistant",
  parentID: user.id,
  time: { created: 2 },
  agent: "build",
  providerID: "acme",
  modelID: "coder",
  mode: "build",
  path: { cwd: "/workspace/demo", root: "/workspace/demo" },
  tokens: { input: 1, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0,
} as Message
setStore("message", sid, [user, answer])
setStore("part", user.id, [
  { id: "p_user", sessionID: sid, messageID: user.id, type: "text", text: "PTY user \u4e2d\u6587 \ud83d\ude80" },
])
setStore("session_status", sid, { type: "busy" })
mark("stream")
let text = ""
for (let token = 0; token < 20; token++) {
  text += `Stream-${token} \u4e2d\u6587 \ud83d\ude80\n\n`
  setStore("part", answer.id, [
    {
      id: "p_text",
      sessionID: sid,
      messageID: answer.id,
      type: "text",
      text: text + "```ts\nconst pty_code = 42\n",
      time: { start: 2 },
    },
  ])
  await delay(70)
}
const tool = (id: string, title: string): Part => ({
  id,
  sessionID: sid,
  messageID: answer.id,
  type: "tool",
  tool: "bash",
  callID: id,
  state: { status: "completed", title, input: {}, output: "ok", metadata: {}, time: { start: 3, end: 4 } },
})
setStore("part", answer.id, [
  {
    id: "p_text",
    sessionID: sid,
    messageID: answer.id,
    type: "text",
    text: text + "```ts\nconst pty_code = 42\n```\n\nPTY final",
    time: { start: 2, end: 3 },
  },
  tool("p_tool1", "PTY tool one"),
  tool("p_tool2", "PTY tool two"),
])
await delay(150)
mark("stream-end")
for (const [id, permission, stage] of [
  ["pty_allow", "bash", "allow"],
  ["pty_deny", "edit", "deny"],
] as const) {
  setStore("permission", sid, [{ id, sessionID: sid, permission, patterns: ["demo"], always: [], metadata: {} }])
  await delay(120)
  mark(stage)
  await waitFor(() => !store.permission[sid]?.length)
}
mark("exit")
// Exercise the editor's Ctrl+C confirmation path with the real terminal parser.
await delay(10000)
throw new Error("PTY driver did not exit frontend")
