import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal, For, Show, type Setter } from "solid-js"
import { SessionNavigation } from "../../../src/cli/cmd/tui/component/session-navigation"
import { DialogAttention } from "../../../src/cli/cmd/tui/component/dialog-attention"

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  trigger: vi.fn(),
  clear: vi.fn(),
  setSize: vi.fn(),
  reply: vi.fn(),
  connected: true,
  revision: (): number => 0,
  invalidate: () => {},
  current: "root",
  permissions: {} as Record<string, { id: string; sessionID: string }[]>,
  questions: {} as Record<string, { id: string; sessionID: string }[]>,
  sessions: [
    { id: "root", title: "Parent session", directory: "/workspace", time: { updated: 2 } },
    { id: "child", title: "Child session", parentID: "root", directory: "/workspace", time: { updated: 3 } },
    { id: "other", title: "Other workspace", directory: "/other", time: { updated: 4 } },
  ],
}))

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})

vi.mock("@tui/context/sync", () => ({
  useSync: () => ({
    data: {
      session: mocked.sessions,
      session_loaded: true,
      session_status: { child: { type: "busy" } },
      status: "complete",
      path: { directory: "/workspace" },
      get permission() {
        mocked.revision()
        return mocked.permissions
      },
      get question() {
        mocked.revision()
        return mocked.questions
      },
    },
    session: { get: (id: string) => mocked.sessions.find((session) => session.id === id) },
  }),
}))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({
    directory: "/workspace",
    get sseConnected() {
      return mocked.connected
    },
    client: { permission: { reply: mocked.reply }, question: { reply: mocked.reply, reject: mocked.reply } },
  }),
}))
vi.mock("@tui/context/route", () => ({
  useRoute: () => ({ data: { type: "session", sessionID: mocked.current }, navigate: mocked.navigate }),
}))
vi.mock("@tui/context/theme", () => ({ useTheme: () => ({ theme: {} }) }))
vi.mock("@tui/context/local", () => ({
  useLocal: () => ({ session: { pinned: () => [], slots: () => ["root"] } }),
}))
vi.mock("../../../src/cli/cmd/tui/component/dialog-command", () => ({
  useCommandDialog: () => ({ trigger: mocked.trigger }),
}))
vi.mock("@tui/ui/dialog", () => ({ useDialog: () => ({ clear: mocked.clear, setSize: mocked.setSize }) }))
vi.mock("@tui/ui/dialog-select", () => ({ DialogSelect: () => undefined }))

type Element = { type: unknown; props: Record<string, unknown> }
const disposals: (() => void)[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocked.connected = true
  const [revision, setRevision] = createSignal(0)
  mocked.revision = revision
  mocked.invalidate = () => {
    setRevision((value) => value + 1)
  }
  mocked.current = "root"
  mocked.permissions = {}
  mocked.questions = {}
  // Run actual application callbacks using the existing classic-JSX test
  // transform. Terminal nodes are captured; native layout is tested separately.
  vi.stubGlobal("React", {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
  })
})
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  vi.unstubAllGlobals()
})

function resolve(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolve)
  if (!value || typeof value !== "object" || !("props" in value)) return value
  const node = value as Element
  if (node.type === Show) return resolve(node.props.when ? node.props.children : node.props.fallback)
  if (node.type === For) {
    const render = node.props.children as (item: unknown, index: () => number) => unknown
    return (node.props.each as unknown[]).map((item, index) => resolve(render(item, () => index)))
  }
  return { ...node, props: { ...node.props, children: resolve(node.props.children) } }
}
function text(value: unknown): string {
  if (value === undefined || value === null || typeof value === "boolean") return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(text).join("")
  return text((value as Element).props.children)
}
function find(value: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(value)) return value.map((child) => find(child, predicate)).find(Boolean)
  if (!value || typeof value !== "object" || !("props" in value)) return undefined
  const node = value as Element
  return predicate(node) ? node : find(node.props.children, predicate)
}
function mount(component: () => unknown): Element {
  return createRoot((dispose) => {
    disposals.push(dispose)
    return resolve(component()) as Element
  })
}
function click(tree: Element, label: string) {
  const node = find(tree, (item) => typeof item.props.onMouseUp === "function" && text(item) === label)
  expect(node, `Clickable node: ${label}`).toBeDefined()
  const stopPropagation = vi.fn()
  ;(node!.props.onMouseUp as (event: { stopPropagation: () => void }) => void)({ stopPropagation })
  return stopPropagation
}

function navigationProps(initial: ReadonlySet<string> = new Set()) {
  const [expanded, updateExpanded] = createSignal(initial)
  const setExpanded = vi.fn(updateExpanded as Setter<ReadonlySet<string>>)
  return {
    width: 24,
    get expanded() {
      return expanded()
    },
    setExpanded,
  }
}

describe("session navigation callbacks", () => {
  test("dispatches commands through the existing command registry", () => {
    const tree = mount(() => SessionNavigation(navigationProps()))
    click(tree, "+ New session")
    click(tree, "All requests (0)")
    click(tree, "/navigation to hide")
    expect(mocked.trigger.mock.calls).toEqual([["session.new"], ["session.attention"], ["session.navigation"]])
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("expansion consumes the click without navigating or approving", () => {
    const props = navigationProps()
    const tree = mount(() => SessionNavigation(props))
    props.setExpanded.mockClear()
    const initiallyExpanded = props.expanded.has("root")
    const toggle = find(tree, (item) => item.props.width === 2 && typeof item.props.onMouseUp === "function")!
    const stopPropagation = vi.fn()
    ;(toggle.props.onMouseUp as (event: { stopPropagation: () => void }) => void)({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(props.setExpanded).toHaveBeenCalledOnce()
    expect(props.expanded.has("root")).toBe(!initiallyExpanded)
    ;(toggle.props.onMouseUp as (event: { stopPropagation: () => void }) => void)({ stopPropagation })
    expect(props.expanded.has("root")).toBe(initiallyExpanded)
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.trigger).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("retains a manually collapsed current root when the dock remounts after resize", () => {
    const props = navigationProps(new Set(["root"]))
    const first = mount(() => SessionNavigation(props))
    const toggle = find(first, (item) => item.props.width === 2 && typeof item.props.onMouseUp === "function")!
    ;(toggle.props.onMouseUp as (event: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() })
    expect(props.expanded.has("root")).toBe(false)
    disposals.pop()!()
    mount(() => SessionNavigation(props))
    expect(props.expanded.has("root")).toBe(false)
  })

  test("session titles navigate and exclude sessions belonging to another workspace", () => {
    const tree = mount(() => SessionNavigation(navigationProps()))
    click(tree, "1 Parent session")
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "root" })
    expect(text(tree)).not.toContain("Other workspace")
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("disconnected navigation is labeled cached and suppresses live work labels", () => {
    mocked.connected = false
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Cached; disconnected")
    expect(text(tree)).not.toContain("Work")
    click(tree, "1 Parent session")
    expect(mocked.navigate).toHaveBeenCalledOnce()
    expect(mocked.reply).not.toHaveBeenCalled()
  })
})

type AttentionOption = {
  value?: { id: string; sessionID: string; kind: "approval" | "question" }
  title: string
  description?: string
  disabled?: boolean
}
function attention() {
  const tree = mount(DialogAttention)
  return {
    options: tree.props.options as AttentionOption[],
    select: tree.props.onSelect as (option: AttentionOption) => void,
    title: tree.props.title,
  }
}

describe("pending request navigation callbacks", () => {
  test("navigates to the owning child without responding to its approval", () => {
    mocked.permissions = { child: [{ id: "approval", sessionID: "child" }] }
    const dialog = attention()
    expect(dialog.options[0]).toMatchObject({ title: "Child session", description: "Approval needed" })
    dialog.select(dialog.options[0])
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" })
    expect(mocked.clear).toHaveBeenCalledOnce()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("keeps question and approval navigation distinct even when their IDs match", () => {
    mocked.permissions = { root: [{ id: "same", sessionID: "root" }] }
    mocked.questions = { child: [{ id: "same", sessionID: "child" }] }
    const dialog = attention()
    expect(dialog.options).toHaveLength(2)
    const question = dialog.options.find((option) => option.description === "Question pending")!
    dialog.select(question)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" })
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("allows cached navigation after another client resolves the selected request", () => {
    mocked.connected = false
    mocked.permissions = { child: [{ id: "approval", sessionID: "child" }] }
    const dialog = attention()
    const selected = dialog.options[0]
    mocked.permissions = {}
    mocked.invalidate()
    expect(dialog.title).toBe("Pending requests (cached)")
    dialog.select(selected)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" })
    expect(mocked.clear).toHaveBeenCalledOnce()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("prefers the current request owner over a cached option", () => {
    mocked.permissions = { root: [{ id: "approval", sessionID: "root" }] }
    const dialog = attention()
    const selected = dialog.options[0]
    mocked.permissions = { child: [{ id: "approval", sessionID: "child" }] }
    mocked.invalidate()
    dialog.select(selected)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" })
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("uses an orphan session ID and leaves the empty placeholder inert", () => {
    mocked.questions = { missing: [{ id: "question", sessionID: "missing" }] }
    const orphan = attention()
    expect(orphan.options[0].title).toBe("missing")
    orphan.select(orphan.options[0])
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "missing" })
    mocked.navigate.mockClear()
    mocked.clear.mockClear()
    mocked.questions = {}
    const empty = attention()
    expect(empty.options[0]).toMatchObject({ title: "No known pending requests", disabled: true })
    empty.select(empty.options[0])
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.clear).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })
})
