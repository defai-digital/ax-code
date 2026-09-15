import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
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
      session: [],
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
vi.mock("@tui/context/content-dimensions", () => ({ useContentDimensions: () => () => ({ width: 120, height: 40 }) }))
vi.mock("@tui/context/kv", () => ({
  useKV: () => ({ set: mocked.setKV, get: (_key: string, fallback: unknown) => fallback }),
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
})
