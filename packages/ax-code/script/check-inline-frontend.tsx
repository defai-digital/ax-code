// Real split-footer frontend check. Sync is stubbed; Prompt, providers, surfaces and renderer are real.
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"
import { writeSync } from "node:fs"

import assert from "node:assert/strict"

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
          `  globalThis.__AX_INLINE_CAPTURE__?.()`,
          `  return value`,
          `}`,
        ].join("\n"),
      }
    }
    return nextLoad(url, context)
  },
})

const { testRender } = await import("ax-tui/solid")
const { createStore } = await import("solid-js/store")
const { Config } = await import("../src/config/config")
const { InlineRoot } = await import("../src/cli/tui/inline")
const { createTuiRenderOptionsFromProfile, resolveTuiRenderProfile } = await import("../src/cli/tui/renderer")
const { resetActiveTuiTerminal } = await import("../src/cli/tui/util/lifecycle")
const { createInitialSyncState } = await import("../src/cli/tui/context/sync-state")
const { createSyncContextValue } = await import("../src/cli/tui/context/sync-result")
import type { Agent, Model, Provider, Message, Part } from "@ax-code/sdk/v2"

const { useDialog } = await import("../src/cli/tui/ui/dialog")
const { DialogConfirm } = await import("../src/cli/tui/ui/dialog-confirm")
const { DialogAlert } = await import("../src/cli/tui/ui/dialog-alert")
let footerDialog: ReturnType<typeof useDialog> | undefined
;(globalThis as { __AX_INLINE_CAPTURE__?: () => void }).__AX_INLINE_CAPTURE__ = () => {
  try {
    footerDialog = useDialog()
  } catch {
    /* Sync also runs above the dialog provider. */
  }
}

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
const offlineFetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const payload = url.pathname === "/permission/auto-accept" ? { enabled: false, managedDisabled: false } : []
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
}) as typeof fetch
const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: true, screenFlag: "inline" })
const setup = await testRender(
  () => (
    <InlineRoot
      input={{
        url: "http://127.0.0.1:9",
        args: { sessionID: sid },
        config: { keybinds: Config.Keybinds.parse({}) },
        directory: "/workspace/demo",
        fetch: offlineFetch,
        events: { on: () => () => {} },
      }}
      profile={profile}
      onExit={async () => {}}
    />
  ),
  {
    ...createTuiRenderOptionsFromProfile(profile),
    kittyKeyboard: true,
    width: 80,
    height: 24,
  },
)
let committed = ""
async function poll() {
  await new Promise((resolve) => setTimeout(resolve, 20))
  await setup.flush()
  await setup.renderOnce()
  committed += setup.externalOutput.takeText()
}
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`${label}\nscrollback:\n${committed}\nfooter:\n${setup.captureCharFrame()}`)
    await poll()
  }
}
const user = {
  id: "msg_1",
  sessionID: sid,
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "acme", modelID: "coder" },
} as Message
const answer = {
  id: "msg_2",
  sessionID: sid,
  role: "assistant",
  parentID: user.id,
  time: { created: 2 },
  agent: "build",
  providerID: "acme",
  modelID: "coder",
  mode: "build",
  path: { cwd: "/workspace/demo", root: "/workspace/demo" },
  tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 12.34,
} as Message
const part = (text: string, done = false): Part => ({
  id: "prt_answer",
  sessionID: sid,
  messageID: answer.id,
  type: "text",
  text,
  time: done ? { start: 2, end: 3 } : { start: 2 },
})
const tool = (id: string, title: string): Part => ({
  id,
  sessionID: sid,
  messageID: answer.id,
  type: "tool",
  tool: "bash",
  callID: id,
  state: { status: "completed", title, input: {}, output: "ok", metadata: {}, time: { start: 3, end: 4 } },
})
try {
  await until(() => setup.captureCharFrame().includes("Ask anything"), "Prompt did not mount")
  assert.equal(setup.renderer.footerHeight, 4)
  assert(setup.captureCharFrame().includes("queued 0"), "Status row is clipped")
  setup.mockInput.pressKey("p", { ctrl: true })
  await until(() => setup.captureCharFrame().includes("Commands"), "Footer command palette missing")
  await setup.mockInput.typeText("Switch model")
  setup.mockInput.pressEnter()
  await until(() => setup.captureCharFrame().includes("Coder"), "Footer model picker missing")
  setup.mockInput.pressEscape()
  await until(() => setup.captureCharFrame().includes("Ask anything"), "Dialog did not restore Prompt")
  setup.mockInput.pressKey("p", { ctrl: true })
  await until(() => setup.captureCharFrame().includes("Commands"), "Command palette did not reopen")
  await setup.mockInput.typeText("Switch agent")
  setup.mockInput.pressEnter()
  await until(
    () => setup.captureCharFrame().includes("build") && !setup.captureCharFrame().includes("Switch agent"),
    "Footer agent picker missing",
  )
  setup.mockInput.pressKey("c", { ctrl: true })
  await until(() => setup.captureCharFrame().includes("Ask anything"), "Ctrl+C did not close dialog")
  assert(footerDialog, "Inline dialog context was not captured")
  const confirmation = DialogConfirm.show(footerDialog, "Footer confirm check", "A small confirmation")
  await until(() => setup.captureCharFrame().includes("Footer confirm check"), "Footer confirmation missing")
  setup.mockInput.pressEnter()
  assert.equal(await confirmation, true)
  const alert = DialogAlert.show(footerDialog, "Footer alert check", "A small alert")
  await until(() => setup.captureCharFrame().includes("Footer alert check"), "Footer alert missing")
  setup.mockInput.pressEnter()
  await alert
  let unsupportedMounted = false
  let unavailableClosed = false
  footerDialog.replace(
    () => {
      unsupportedMounted = true
      throw new Error("Unsupported overlay mounted")
    },
    () => {
      unavailableClosed = true
    },
  )
  await until(() => committed.includes("full-screen"), "Unsupported dialog hint missing")
  assert(!unsupportedMounted && unavailableClosed, "Unsupported dialog bypassed admission policy")
  setStore("message", sid, [user])
  setStore("part", user.id, [
    { id: "prt_user", sessionID: sid, messageID: user.id, type: "text", text: "Explain inline mode" },
  ])
  setStore("session_status", sid, { type: "busy" })
  await until(() => committed.includes("You: Explain inline mode"), "User message was not committed")
  setStore("message", sid, [user, answer])
  setStore("part", answer.id, [part("**Stable paragraph.**\n\n```ts\nconst answer = 42\n")])
  await until(
    () => committed.includes("Stable paragraph.") && setup.captureCharFrame().includes("const answer"),
    "Streaming preview missing",
  )
  assert(!committed.includes("const answer"), "Open code fence leaked into scrollback")
  const full = "**Stable paragraph.**\n\n```ts\nconst answer = 42\n```\n\nFinal paragraph."
  setStore("part", answer.id, [part(full, true), tool("prt_tool1", "First tool"), tool("prt_tool2", "Second tool")])
  setStore("message", sid, [user, { ...answer, time: { created: 2, completed: 5 } } as Message])
  setStore("session_status", sid, { type: "idle" })
  await until(() => committed.includes("Tokens:"), "Turn did not finish")
  // Real permission/question components own focus, submit once, and remove locally.
  await setup.mockInput.typeText("Saved draft")
  for (const [id, permission, deny] of [
    ["per_allow", "bash", false],
    ["per_deny", "edit", true],
  ] as const) {
    setStore("permission", sid, [{ id, sessionID: sid, permission, patterns: ["demo"], always: [], metadata: {} }])
    await until(() => setup.captureCharFrame().includes("Permission"), "Permission footer missing")
    if (!deny) {
      setup.mockInput.pressKey("ARROW_RIGHT")
      await until(() => setup.captureCharFrame().includes("\u203a Reject"), "Permission selection did not move")
      const nested = DialogAlert.show(footerDialog, "Nested alert", "Keep permission state")
      await until(() => setup.captureCharFrame().includes("Nested alert"), "Nested footer dialog missing")
      setup.mockInput.pressEnter()
      await nested
      await until(() => setup.captureCharFrame().includes("\u203a Reject"), "Dialog reset permission state")
      setup.mockInput.pressKey("ARROW_LEFT")
    }
    await setup.mockInput.typeText("x")
    if (deny) setup.mockInput.pressKey("c", { ctrl: true })
    else setup.mockInput.pressEnter()
    await until(() => committed.includes(deny ? "Denied edit" : "Allowed bash once"), "Decision record missing")
    assert.equal(store.permission[sid]?.length ?? 0, 0)
  }
  setStore("question", sid, [
    {
      id: "que_check",
      sessionID: sid,
      questions: [
        {
          header: "Pick",
          question: "Choose safely",
          options: [{ label: "Yes", description: "Continue" }],
          custom: false,
        },
      ],
    },
  ])
  await until(() => setup.captureCharFrame().includes("Choose safely"), "Question footer missing")
  setup.mockInput.pressKey("RETURN")
  await until(() => committed.includes("Answered question"), "Question record missing")
  assert(setup.captureCharFrame().includes("Saved draft"), "Modal input changed the saved draft")
  assert(!setup.captureCharFrame().includes("Saved draftx"), "Permission leaked input to Prompt")
  // Clear the saved draft before checking multi-line growth.
  setup.mockInput.pressKey("c", { ctrl: true })
  // Replayed store snapshots must not replay already-committed blocks.
  for (let i = 0; i < 3; i++) {
    setStore("part", answer.id, [part(full, true), tool("prt_tool1", "First tool"), tool("prt_tool2", "Second tool")])
    await poll()
  }
  const expected = [
    "You: Explain inline mode",
    "Stable paragraph.",
    "const answer = 42",
    "Final paragraph.",
    "[completed] bash: First tool",
    "[completed] bash: Second tool",
    "Tokens: 100 input, 20 output, 0 reasoning",
  ]
  let cursor = -1
  for (const text of expected) {
    assert.equal(committed.split(text).length - 1, 1, `Expected exactly one ${text}\n${committed}`)
    const next = committed.indexOf(text)
    assert(next > cursor, `Out-of-order block: ${text}`)
    cursor = next
  }
  assert(!committed.includes("```"), "Code fences were not rendered as text")
  assert(!committed.includes("$"), "Turn summary exposed dollar amounts")
  await setup.mockInput.typeText("Draft stays editable")
  await until(() => setup.captureCharFrame().includes("Draft stays editable"), "Prompt is not editable")
  setup.mockInput.pressEnter({ shift: true })
  await setup.mockInput.typeText("second row")
  setup.mockInput.pressEnter({ shift: true })
  await setup.mockInput.typeText("third row")
  await until(
    () =>
      setup.renderer.footerHeight === 6 &&
      setup.captureCharFrame().includes("third row") &&
      setup.captureCharFrame().includes("queued 0"),
    "Multi-line draft did not grow the footer with a visible status row",
  )
  assert(setup.captureCharFrame().includes("queued 0"), "Expanded draft clipped the status row")
  setup.resize(60, 10)
  await poll()
  assert.equal(setup.renderer.footerHeight, 6)
  setup.resize(60, 4)
  await poll()
  assert(setup.renderer.footerHeight <= 3, "Footer did not clamp to terminal height minus one")
  writeSync(
    1,
    "check:inline-frontend passed: native scrollback once, in order; streaming preview and editable Prompt\n",
  )
} finally {
  await resetActiveTuiTerminal()
  await fsp.rm(state, { recursive: true, force: true })
}
process.exit(0)
