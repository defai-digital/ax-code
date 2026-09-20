import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal, Show } from "solid-js"
import { dictionaries } from "../../../src/cli/tui/i18n"
import type { PromptInfo } from "../../../src/cli/tui/component/prompt/prompt-info"

const mocked = vi.hoisted(() => ({
  revision: (): number => 0,
  invalidate: () => {},
  loaded: true,
  failed: false,
  ready: true,
  cliPrompt: undefined as string | undefined,
  route: { workspaceID: undefined as string | undefined, initialPrompt: undefined as PromptInfo | undefined },
  input: { input: "", parts: [] } as PromptInfo,
  sessions: [] as unknown[],
  height: 40,
  kvStore: {} as Record<string, unknown>,
  submit: vi.fn(),
  createSession: vi.fn(),
  setWorkspace: vi.fn(),
  navigate: vi.fn(),
  setKV: vi.fn(),
  toast: vi.fn(),
  setPromptRef: vi.fn(),
  promptType: undefined as unknown,
}))
vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
vi.mock("@tui/component/prompt", () => {
  const Prompt = (props: { ref: (ref: unknown) => void }) => {
    props.ref({
      get current() {
        return mocked.input
      },
      set: (prompt: PromptInfo) => {
        mocked.input = prompt
      },
      submit: mocked.submit,
    })
    return undefined
  }
  mocked.promptType = Prompt
  return { Prompt }
})
vi.mock("@tui/context/sync", () => ({
  useSync: () => ({
    data: {
      get provider_loaded() {
        mocked.revision()
        return mocked.loaded
      },
      get provider_failed() {
        mocked.revision()
        return mocked.failed
      },
      provider: [{ id: "test", models: { model: {} } }],
      session_loaded: true,
      get session() {
        mocked.revision()
        return mocked.sessions
      },
      mcp: {},
    },
  }),
}))
vi.mock("@tui/context/theme", () => ({ useTheme: () => ({ theme: {} }) }))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({
    directory: "/launch",
    baseDirectory: "/launch",
    setWorkspace: mocked.setWorkspace,
    client: { session: { create: mocked.createSession } },
  }),
}))
vi.mock("@tui/context/route", () => ({
  useRoute: () => ({ data: mocked.route, navigate: mocked.navigate }),
  useRouteData: () => mocked.route,
}))
vi.mock("@tui/context/keybind", () => ({ useKeybind: () => ({ print: () => "key" }) }))
vi.mock("@tui/context/prompt", () => ({ usePromptRef: () => ({ set: mocked.setPromptRef }) }))
vi.mock("@tui/context/args", () => ({
  useArgs: () => ({
    get prompt() {
      return mocked.cliPrompt
    },
  }),
}))
vi.mock("@tui/context/directory", () => ({ useDirectory: () => () => "/launch" }))
vi.mock("@tui/context/content-dimensions", () => ({
  useContentDimensions: () => () => ({ width: 120, height: mocked.height }),
}))
vi.mock("@tui/context/kv", () => ({
  useKV: () => ({
    set: (key: string, value: unknown) => {
      mocked.kvStore[key] = value
      mocked.setKV(key, value)
    },
    get: (key: string, fallback: unknown) => mocked.kvStore[key] ?? fallback,
  }),
}))
vi.mock("@tui/context/local", () => ({
  useLocal: () => ({
    model: {
      get ready() {
        mocked.revision()
        return mocked.ready
      },
      current: () => ({ providerID: "test", modelID: "model" }),
      parsed: () => ({ model: "Test model", provider: "Test provider" }),
    },
    agent: { current: () => ({ name: "build" }) },
  }),
}))
vi.mock("@tui/ui/toast", () => ({ Toast: () => undefined, useToast: () => ({ show: mocked.toast }) }))
vi.mock("../../../src/cli/tui/component/dialog-command", () => ({ useCommandDialog: () => ({ trigger: vi.fn() }) }))
vi.mock("../../../src/cli/tui/component/logo", () => ({ Logo: () => undefined }))
vi.mock("../../../src/cli/tui/component/mode-chips", () => ({ ModeChips: () => undefined }))
vi.mock("../../../src/cli/tui/component/work-mode-notice", () => ({ WorkModeNotice: () => undefined }))

const disposals: (() => void)[] = []
let originalExitCode: typeof process.exitCode

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  originalExitCode = process.exitCode
  const [revision, setRevision] = createSignal(0)
  mocked.revision = revision
  mocked.invalidate = () => {
    setRevision((value) => value + 1)
  }
  mocked.loaded = true
  mocked.failed = false
  mocked.ready = true
  mocked.cliPrompt = undefined
  mocked.route = { workspaceID: undefined, initialPrompt: undefined }
  mocked.input = { input: "", parts: [] }
  mocked.sessions = []
  mocked.height = 40
  mocked.kvStore = {}
  mocked.navigate.mockImplementation((route: typeof mocked.route) => {
    mocked.route.workspaceID = route.workspaceID
    mocked.route.initialPrompt = route.initialPrompt
  })
  vi.stubGlobal("React", {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
      // Mount only the shared composer fixture before Home onMount runs.
      // Home's actual lifecycle/effects run; terminal layout is tested by PTY.
      if (type === mocked.promptType) return (type as (props: unknown) => unknown)(props)
      return { type, props: { ...props, children } }
    },
    Fragment: Symbol("Fragment"),
  })
})
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  process.exitCode = originalExitCode
  vi.unstubAllGlobals()
})

async function home() {
  const { Home } = await import("../../../src/cli/tui/routes/home")
  return () =>
    createRoot((dispose) => {
      disposals.push(dispose)
      return Home()
    })
}

describe("new task Home lifecycle", () => {
  test("opening an empty new task neither submits nor creates a server session", async () => {
    const mount = await home()
    mount()
    expect(mocked.setPromptRef).toHaveBeenCalledOnce()
    expect(mocked.submit).not.toHaveBeenCalled()
    expect(mocked.createSession).not.toHaveBeenCalled()
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.input.input).toBe("")
  })

  test.each([undefined, "/selected-project"])("resets an inherited workspace pin to %s", async (workspaceID) => {
    mocked.route.workspaceID = workspaceID
    ;(await home())()
    expect(mocked.setWorkspace).toHaveBeenCalledExactlyOnceWith(workspaceID)
    expect(mocked.createSession).not.toHaveBeenCalled()
  })

  test("waits for provider/model readiness then submits the CLI prompt once across remounts", async () => {
    mocked.cliPrompt = "CLI startup task"
    mocked.loaded = false
    mocked.ready = false
    const mount = await home()
    mount()
    expect(mocked.input.input).toBe("CLI startup task")
    expect(mocked.submit).not.toHaveBeenCalled()
    mocked.loaded = true
    mocked.invalidate()
    expect(mocked.submit).not.toHaveBeenCalled()
    mocked.ready = true
    mocked.invalidate()
    expect(mocked.submit).toHaveBeenCalledOnce()
    disposals.pop()!()
    mocked.input = { input: "User draft on return", parts: [] }
    mount()
    expect(mocked.input.input).toBe("User draft on return")
    expect(mocked.submit).toHaveBeenCalledOnce()
  })

  test("prefers explicit route prefill over CLI text and consumes it without submission", async () => {
    mocked.cliPrompt = "CLI startup task"
    const initial: PromptInfo = { input: "Fork-specific draft", parts: [{ type: "text", text: "attachment" }] }
    mocked.route.initialPrompt = initial
    mocked.route.workspaceID = "/selected-project"
    ;(await home())()
    expect(mocked.input).toEqual(initial)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "home", workspaceID: "/selected-project" })
    expect(mocked.route.initialPrompt).toBeUndefined()
    expect(mocked.submit).not.toHaveBeenCalled()
    expect(mocked.createSession).not.toHaveBeenCalled()
  })

  test("does not auto-submit user edits made while CLI startup waits for providers", async () => {
    mocked.cliPrompt = "CLI startup task"
    mocked.loaded = false
    ;(await home())()
    mocked.input = { input: "User revised the task", parts: [] }
    mocked.loaded = true
    mocked.invalidate()
    expect(mocked.submit).not.toHaveBeenCalled()
    expect(mocked.input.input).toBe("User revised the task")
  })

  test("provider load failure retains CLI input and reports failure once", async () => {
    mocked.cliPrompt = "CLI startup task"
    mocked.loaded = false
    const mount = await home()
    mount()
    mocked.failed = true
    mocked.invalidate()
    expect(process.exitCode).toBe(1)
    expect(mocked.toast).toHaveBeenCalledOnce()
    expect(mocked.input.input).toBe("CLI startup task")
    expect(mocked.submit).not.toHaveBeenCalled()
    disposals.pop()!()
    mount()
    expect(mocked.toast).toHaveBeenCalledOnce()
  })

  test("sets the initial work mode once without resetting it on Home remount", async () => {
    const mount = await home()
    mount()
    expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("work_mode", "agent")
    disposals.pop()!()
    mount()
    expect(mocked.setKV).toHaveBeenCalledOnce()
  })

  test("first-run empty home offers clickable starter examples that prefill the prompt", async () => {
    const tree = (await home())()
    expect(examplesVisible(tree)).toBe(true)
    const rendered = renderedText(tree)
    for (const key of [
      "home.examplesLabel",
      "home.exampleExplain",
      "home.exampleReview",
      "home.exampleExplore",
    ] as const) {
      expect(rendered).toContain(dictionaries.en[key])
    }
    const explain = clickables(tree).find((row) => row.text.includes(dictionaries.en["home.exampleExplain"]))
    expect(explain).toBeDefined()
    explain!.click()
    expect(mocked.input.input).toBe(dictionaries.en["home.exampleExplain"])
    expect(mocked.input.parts).toEqual([])
    expect(mocked.submit).not.toHaveBeenCalled()
    expect(mocked.kvStore[EXAMPLES_DISMISSED_KEY]).toBe(true)
  })

  // The startup surface is the working shell for every user, so returning users
  // keep seeing the examples until they engage once (click or first submit).
  test.each([1, 3])("still offers starter examples to returning users with %i session(s)", async (count) => {
    mocked.sessions = Array.from({ length: count }, () => ({}))
    expect(examplesVisible((await home())())).toBe(true)
  })

  test("hides starter examples once the user dismissed them", async () => {
    mocked.kvStore[EXAMPLES_DISMISSED_KEY] = true
    expect(examplesVisible((await home())())).toBe(false)
  })

  test("submitting a task from Home dismisses the starter examples", async () => {
    const mount = await home()
    mount()
    expect(mocked.setKV).not.toHaveBeenCalledWith(EXAMPLES_DISMISSED_KEY, true)
    mocked.sessions = [{ id: "ses_new" }]
    mocked.invalidate()
    expect(mocked.setKV).toHaveBeenCalledWith(EXAMPLES_DISMISSED_KEY, true)
  })

  test("hides starter examples in compact terminals", async () => {
    mocked.height = 21
    expect(examplesVisible((await home())())).toBe(false)
  })
})

const EXAMPLES_DISMISSED_KEY = "home_examples_dismissed"

// The lifecycle harness renders Home through a createElement stub that never
// executes components, so conditional children stay in the tree as data and
// visibility is only observable as the evaluated `when` prop of the Show node.
function examplesVisible(tree: unknown): boolean {
  const label = dictionaries.en["home.examplesLabel"]
  const whens: boolean[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== "object" || !("props" in node)) return
    const { type, props } = node as { type: unknown; props: Record<string, unknown> }
    if (type === Show && typeof props.when === "boolean" && renderedText(props.children).includes(label))
      whens.push(props.when)
    walk(props.children)
  }
  walk(tree)
  expect(whens).toHaveLength(1)
  return whens[0]
}

// Walk the stub tree for visible strings and mouse-click handlers.
function renderedText(node: unknown, out: string[] = []): string {
  if (typeof node === "string") out.push(node)
  else if (Array.isArray(node)) for (const child of node) renderedText(child, out)
  else if (node && typeof node === "object")
    for (const value of Object.values(node as Record<string, unknown>)) renderedText(value, out)
  return out.join("\n")
}

function clickables(
  node: unknown,
  out: { text: string; click: () => void }[] = [],
): { text: string; click: () => void }[] {
  if (Array.isArray(node)) {
    for (const child of node) clickables(child, out)
    return out
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: Record<string, unknown> }).props
    if (typeof props.onMouseUp === "function")
      out.push({ text: renderedText(props.children), click: props.onMouseUp as () => void })
    clickables(props.children, out)
  }
  return out
}
