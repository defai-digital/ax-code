import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal, For, Show, type Setter } from "solid-js"
import { SessionNavigation } from "../../../src/cli/tui/component/session-navigation"
import { NavigationBar } from "../../../src/cli/tui/component/navigation-bar"
import { Spinner } from "../../../src/cli/tui/component/spinner"
import { DialogNavigationWidth, DialogSidebarWidth } from "../../../src/cli/tui/component/dialog-navigation-width"
import { DialogSessionList } from "../../../src/cli/tui/component/dialog-session-list"
import { DialogNavigationOptions } from "../../../src/cli/tui/component/dialog-navigation-options"
import { DialogAttention } from "../../../src/cli/tui/component/dialog-attention"
import { ChromeWidthAction } from "../../../src/cli/tui/component/chrome-action"

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  trigger: vi.fn(),
  clear: vi.fn(),
  setSize: vi.fn(),
  reply: vi.fn(),
  confirm: vi.fn(async (_dialog?: unknown, _title?: string, _message?: string): Promise<boolean | undefined> => true),
  connected: true,
  kv: {} as Record<string, unknown>,
  setKV: vi.fn(),
  revision: (): number => 0,
  invalidate: () => {},
  current: "root",
  permissions: {} as Record<string, { id: string; sessionID: string }[]>,
  questions: {} as Record<string, { id: string; sessionID: string }[]>,
  statuses: { child: { type: "busy" } } as Record<string, { type: string }>,
  sessions: [
    { id: "root", title: "Parent session", directory: "/workspace", time: { updated: 2 } },
    { id: "child", title: "Child session", parentID: "root", directory: "/workspace", time: { updated: 3 } },
    { id: "idle", title: "Earlier session", directory: "/workspace", time: { updated: 1 } },
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
      get session_status() {
        return mocked.statuses
      },
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
vi.mock("@tui/context/keybind", () => ({ useKeybind: () => ({ all: {}, print: (key: string) => key }) }))
vi.mock("@tui/ui/toast", () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock("../../../src/cli/tui/component/spinner", () => ({ Spinner: () => undefined }))
vi.mock("../../../src/cli/tui/component/dialog-session-rename", () => ({ DialogSessionRename: () => undefined }))
vi.mock("@tui/context/theme", () => ({ useTheme: () => ({ theme: {} }) }))
vi.mock("@tui/context/kv", () => ({
  useKV: () => ({
    get: (key: string, fallback: unknown) => {
      mocked.revision()
      return mocked.kv[key] ?? fallback
    },
    set: (key: string, value: unknown) => {
      mocked.kv[key] = value
      mocked.setKV(key, value)
      mocked.invalidate()
    },
  }),
}))
vi.mock("@tui/context/local", () => ({
  useLocal: () => ({ session: { pinned: () => [], slots: () => ["root"] } }),
}))
vi.mock("../../../src/cli/tui/component/dialog-command", () => ({
  useCommandDialog: () => ({ trigger: mocked.trigger }),
}))
vi.mock("@tui/ui/dialog", () => ({ useDialog: () => ({ clear: mocked.clear, setSize: mocked.setSize }) }))
vi.mock("@tui/ui/dialog-confirm", () => ({
  DialogConfirm: {
    show: (dialog: unknown, title: string, message: string) => mocked.confirm(dialog, title, message),
  },
}))
vi.mock("@tui/ui/dialog-select", () => ({ DialogSelect: () => undefined }))

type Element = { type: unknown; props: Record<string, unknown> }
const disposals: (() => void)[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocked.connected = true
  mocked.kv = {}
  const [revision, setRevision] = createSignal(0)
  mocked.revision = revision
  mocked.invalidate = () => {
    setRevision((value) => value + 1)
  }
  mocked.current = "root"
  mocked.permissions = {}
  mocked.questions = {}
  mocked.statuses = { child: { type: "busy" } }
  mocked.sessions = [
    { id: "root", title: "Parent session", directory: "/workspace", time: { updated: 2 } },
    { id: "child", title: "Child session", parentID: "root", directory: "/workspace", time: { updated: 3 } },
    { id: "idle", title: "Earlier session", directory: "/workspace", time: { updated: 1 } },
    { id: "other", title: "Other workspace", directory: "/other", time: { updated: 4 } },
  ]
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
function collect(value: unknown, predicate: (node: Element) => boolean, into: Element[] = []): Element[] {
  if (Array.isArray(value)) {
    for (const child of value) collect(child, predicate, into)
    return into
  }
  if (!value || typeof value !== "object" || !("props" in value)) return into
  const node = value as Element
  if (predicate(node)) into.push(node)
  collect(node.props.children, predicate, into)
  return into
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
  test("keeps New, Find, /navigation, width and Options visible without an empty attention card", () => {
    const tree = mount(() => SessionNavigation(navigationProps()))
    click(tree, "+ New session")
    click(tree, "Find session…")
    click(tree, "/navigation")
    click(tree, "Navigation options ›")
    // ChromeWidthAction derives its label internally, so assert its wiring directly.
    const width = find(tree, (item) => item.type === ChromeWidthAction)
    expect(width?.props.width).toBe(28)
    ;(width!.props.onMouseUp as () => void)()
    expect(mocked.trigger.mock.calls).toEqual([
      ["session.new"],
      ["session.navigation.find"],
      ["session.navigation"],
      ["session.navigation.options"],
      ["session.navigation.width"],
    ])
    expect(text(tree)).not.toContain("Across workspaces")
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("project identity opens details and options delegate to existing commands", () => {
    click(
      mount(() => SessionNavigation(navigationProps())),
      "workspace",
    )
    const picker = mount(() => DialogNavigationOptions({ onCommand: mocked.trigger }))
    const options = picker.props.options as { title: string; value: string }[]
    const select = picker.props.onSelect as (option: { value: string }) => void
    expect(options.map((option) => option.value)).toEqual(["session.navigation.info", "session.navigation.clear"])
    for (const option of options) select(option)
    expect(mocked.trigger.mock.calls).toEqual([
      ["session.navigation.info"],
      ["session.navigation.info"],
      ["session.navigation.clear"],
    ])
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("restores hidden history without deleting sessions or resetting pins", () => {
    mocked.kv.navigation_cleared_at = 10
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).not.toContain("Earlier session")
    click(tree, "Show hidden sessions")
    expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("navigation_cleared_at", 0)
    expect(text(mount(() => SessionNavigation(navigationProps())))).toContain("Earlier session")
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("options can restore a cleared history even when the rail has no hidden rows", () => {
    mocked.kv.navigation_cleared_at = 10
    const picker = mount(() => DialogNavigationOptions({ onCommand: mocked.trigger }))
    const options = picker.props.options as { value: string }[]
    const restore = options.find((option) => option.value === "restore")!
    expect(restore).toBeDefined()
    ;(picker.props.onSelect as (option: { value: string }) => void)(restore)
    expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("navigation_cleared_at", 0)
    expect(mocked.trigger).not.toHaveBeenCalled()
  })

  test("reveals the current nested session without changing persisted expansion", () => {
    mocked.current = "child"
    const props = navigationProps()
    const tree = mount(() => SessionNavigation(props))
    expect(text(tree)).toContain("Child session")
    expect(props.expanded.size).toBe(0)
    expect(props.setExpanded).not.toHaveBeenCalled()
  })

  test("persists the selected filter across remounts and permits switching back", () => {
    const props = navigationProps()
    const recent = mount(() => SessionNavigation(props))
    expect(text(recent)).toContain("Earlier session")
    click(recent, "Active")
    expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("navigation_filter", "active")
    disposals.pop()!()
    const active = mount(() => SessionNavigation(props))
    expect(text(active)).toContain("Parent session")
    expect(text(active)).not.toContain("Earlier session")
    expect(text(active)).toContain("Includes current session")
    click(active, "Recent")
    expect(mocked.setKV).toHaveBeenLastCalledWith("navigation_filter", "recent")
    disposals.pop()!()
    expect(text(mount(() => SessionNavigation(props)))).toContain("Earlier session")
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("retains cached sessions with an explanation when active filtering is unavailable", () => {
    mocked.connected = false
    mocked.kv.navigation_filter = "active"
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Cached sessions; reconnect to filter")
    expect(text(tree)).toContain("Earlier session")
    expect(text(tree)).not.toContain("Working")
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
    click(tree, "Parent session")
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "root" })
    expect(text(tree)).not.toContain("Other workspace")
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("shows explicit activity and labels known requests across workspaces", () => {
    mocked.permissions = {
      child: [{ id: "local", sessionID: "child" }],
      other: [{ id: "remote", sessionID: "other" }],
    }
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Approval needed")
    expect(text(tree)).toContain("Across workspaces")
    click(tree, "Needs attention2Across workspaces")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.attention")
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("disconnected navigation is labeled cached and suppresses live work labels", () => {
    mocked.connected = false
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Cached; disconnected")
    expect(text(tree)).not.toContain("Work")
    click(tree, "Parent session")
    expect(mocked.navigate).toHaveBeenCalledOnce()
    expect(mocked.reply).not.toHaveBeenCalled()
  })
})

type AttentionOption = {
  value?: { id: string; sessionID: string; kind: "approval" | "question" }
  title: string
  description?: string
  category?: string
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
    expect(dialog.title).toBe("Pending requests - known workspaces (cached)")
    dialog.select(selected)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" })
    expect(mocked.clear).toHaveBeenCalledOnce()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("identifies the source workspace for requests outside the current project", () => {
    mocked.permissions = {
      root: [{ id: "local", sessionID: "root" }],
      other: [{ id: "external", sessionID: "other" }],
    }
    const dialog = attention()
    const local = dialog.options.find((option) => option.value?.id === "local")!
    const external = dialog.options.find((option) => option.value?.id === "external")!
    expect(local.category).toContain("workspace")
    expect(local.category).toContain("/workspace")
    expect(external.category).toContain("other")
    expect(external.category).toContain("/other")
    dialog.select(external)
    expect(mocked.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "other" })
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

describe("navigation recovery entry and width selection", () => {
  test.each([24, 36, 50, 80, 145, 200])("keeps a clickable navigation entry at %i columns", (width) => {
    const tree = mount(() => NavigationBar({ width }))
    click(tree, "Sessions /navigation")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.navigation")
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("uses a shorter navigation entry on very narrow terminals", () => {
    const tree = mount(() => NavigationBar({ width: 20 }))
    click(tree, "Sessions")
    expect(text(tree)).not.toContain("workspace")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.navigation")
  })

  test("places a clickable /sidebar restore on the right when the sidebar is collapsed", () => {
    const tree = mount(() => NavigationBar({ width: 80, showSidebarRestore: true }))
    expect(text(tree)).toContain("/sidebar")
    click(tree, "/sidebar")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.sidebar.toggle")
    expect(mocked.navigate).not.toHaveBeenCalled()
  })

  test("omits the sidebar restore until the session chrome asks for it", () => {
    const tree = mount(() => NavigationBar({ width: 80 }))
    expect(text(tree)).not.toContain("/sidebar")
  })

  test("makes the project label an information entry when space is available", () => {
    const tree = mount(() => NavigationBar({ width: 80 }))
    click(tree, "workspace")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.navigation.info")
    expect(mocked.navigate).not.toHaveBeenCalled()
  })

  test("surfaces known attention outside the dock and labels cached counts", () => {
    mocked.permissions = { child: [{ id: "permission", sessionID: "child" }] }
    mocked.connected = false
    const tree = mount(() => NavigationBar({ width: 50 }))
    const pending = find(tree, (item) => typeof item.props.onMouseUp === "function" && text(item) === "Pending 1*")
    expect(pending?.props.paddingLeft).toBe(1)
    expect(pending?.props.paddingRight).toBe(1)
    click(tree, "Pending 1*")
    expect(mocked.trigger).toHaveBeenCalledExactlyOnceWith("session.attention")
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test.each([26, 28, 30, 32, 34, 36, 38])("persists the %i-column width preset and closes the picker", (width) => {
    const tree = mount(DialogNavigationWidth)
    const options = tree.props.options as { title: string; value: number }[]
    expect(options.map((option) => option.value)).toEqual([26, 28, 30, 32, 34, 36, 38])
    expect(mocked.setSize).toHaveBeenCalledWith("medium")
    const select = tree.props.onSelect as (option: { title: string; value: number }) => void
    select(options.find((option) => option.value === width)!)
    expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("navigation_width", width)
    expect(mocked.clear).toHaveBeenCalledOnce()
    disposals.pop()!()
    expect(mount(DialogNavigationWidth).props.current).toBe(width)
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("defaults the sidebar width picker to 32 columns", () => {
    expect(mount(DialogSidebarWidth).props.current).toBe(32)
    expect(mount(DialogNavigationWidth).props.current).toBe(28)
  })

  test.each([26, 28, 30, 32, 34, 36, 38])(
    "persists the %i-column sidebar width preset and closes the picker",
    (width) => {
      const tree = mount(DialogSidebarWidth)
      const options = tree.props.options as { title: string; value: number }[]
      expect(options.map((option) => option.value)).toEqual([26, 28, 30, 32, 34, 36, 38])
      expect(tree.props.title).toBe("Sidebar width")
      const select = tree.props.onSelect as (option: { title: string; value: number }) => void
      select(options.find((option) => option.value === width)!)
      expect(mocked.setKV).toHaveBeenCalledExactlyOnceWith("sidebar_width", width)
      expect(mocked.clear).toHaveBeenCalledOnce()
      disposals.pop()!()
      expect(mount(DialogSidebarWidth).props.current).toBe(width)
      expect(mocked.navigate).not.toHaveBeenCalled()
      expect(mocked.reply).not.toHaveBeenCalled()
    },
  )
})

function sessionPicker(navigation: boolean) {
  const tree = mount(() => DialogSessionList({ navigation, localOnly: true }))
  const select = find(tree, (node) => node.props.title === (navigation ? "Session navigation" : "Local Sessions"))!
  expect(select).toBeDefined()
  return { tree, options: select.props.options as { title: string; value: string }[] }
}

describe("shared navigation picker filters", () => {
  test("active navigation keeps working descendants and excludes earlier idle sessions", () => {
    mocked.kv.navigation_filter = "active"
    const picker = sessionPicker(true)
    expect(picker.options.map((option) => option.value)).toEqual(["root", "child"])
    expect(text(picker.tree)).toContain("Includes current session")
    expect(mocked.navigate).not.toHaveBeenCalled()
    expect(mocked.reply).not.toHaveBeenCalled()
  })

  test("active navigation retains the currently viewed idle session", () => {
    mocked.current = "idle"
    mocked.kv.navigation_filter = "active"
    const picker = sessionPicker(true)
    expect(picker.options.map((option) => option.value)).toEqual(["root", "child", "idle"])
  })

  test("rail and picker controls persist the same filter preference in both directions", () => {
    const rail = mount(() => SessionNavigation(navigationProps()))
    click(rail, "Active")
    const active = sessionPicker(true)
    expect(active.options.map((option) => option.value)).not.toContain("idle")
    click(active.tree, "Recent")
    expect(mocked.setKV.mock.calls).toEqual([
      ["navigation_filter", "active"],
      ["navigation_filter", "recent"],
    ])
    expect(text(mount(() => SessionNavigation(navigationProps())))).toContain("Earlier session")
    expect(sessionPicker(true).options.map((option) => option.value)).toContain("idle")
    expect(mocked.navigate).not.toHaveBeenCalled()
  })

  test("ordinary local picker ignores the navigation filter and keeps its root-only list", () => {
    mocked.kv.navigation_filter = "active"
    const picker = sessionPicker(false)
    expect(picker.options.map((option) => option.value)).toEqual(["root", "idle"])
    expect(
      find(picker.tree, (node) => typeof node.props.onMouseUp === "function" && text(node) === "Recent"),
    ).toBeUndefined()
    expect(
      find(picker.tree, (node) => typeof node.props.onMouseUp === "function" && text(node) === "Active"),
    ).toBeUndefined()
    expect(
      find(picker.tree, (node) => typeof node.props.onMouseUp === "function" && text(node) === "Clear"),
    ).toBeUndefined()
    expect(text(picker.tree)).not.toContain("Includes current session")
    expect(mocked.setKV).not.toHaveBeenCalled()
  })

  test("disconnected active picker preserves cached sessions and explains its fallback", () => {
    mocked.connected = false
    mocked.kv.navigation_filter = "active"
    const picker = sessionPicker(true)
    expect(picker.options.map((option) => option.value)).toEqual(["root", "child", "idle"])
    expect(text(picker.tree)).toContain("Cached sessions; reconnect to filter")
  })
})

describe("goal planner pixel", () => {
  const planner = {
    id: "planner",
    title: "Goal plan writer",
    parentID: "root",
    directory: "/workspace",
    time: { updated: 5 },
  }
  const rail = () => mount(() => SessionNavigation({ ...navigationProps(new Set(["root"])), width: 60 }))
  // The classic-JSX harness keeps nested function components inert, so the
  // pixel is asserted as the Spinner element the rail mounts before the title.
  const pixels = (tree: Element) => collect(tree, (node) => node.type === Spinner)

  test("shows an animated pixel before the Goal plan writer while planning", () => {
    mocked.sessions = [...mocked.sessions, planner]
    mocked.statuses = { child: { type: "busy" }, planner: { type: "busy" } }
    const tree = rail()
    expect(pixels(tree).length).toBe(1)
    const pixel = pixels(tree)[0]
    expect(Array.isArray(pixel.props.frames)).toBe(true)
    expect((pixel.props.frames as string[]).length).toBeGreaterThan(1)
    const ordered = collect(
      tree,
      (node) => node.type === Spinner || (node.type === "text" && text(node) === "Goal plan writer"),
    )
    expect(ordered.length).toBe(2)
    expect(ordered[0].type).toBe(Spinner)
    expect(ordered[1].type).toBe("text")
  })

  test("removes the pixel once the plan writer settles to idle", () => {
    mocked.sessions = [...mocked.sessions, planner]
    mocked.statuses = { child: { type: "busy" }, planner: { type: "idle" } }
    expect(pixels(rail()).length).toBe(0)
  })

  test("does not mark ordinary busy sessions", () => {
    mocked.statuses = { child: { type: "busy" } }
    expect(pixels(rail()).length).toBe(0)
  })
})

describe("first-row status symbol", () => {
  const glyphs = (tree: Element) =>
    collect(tree, (node) => node.type === "text" && ["!", "~", "*"].includes(text(node)))

  test("shows the aggregated working symbol on the title row before the title", () => {
    const tree = mount(() => SessionNavigation(navigationProps()))
    // Root aggregates the busy child subtree even while collapsed; the symbol
    // appears on the title row and again as the label-row marker.
    const ordered = collect(
      tree,
      (node) => node.type === "text" && (text(node) === "*" || text(node) === "Parent session"),
    )
    expect(ordered.map((node) => text(node))).toEqual(["*", "Parent session", "*"])
    expect(text(tree)).toContain("Working")
  })

  test("marks attention with ! on both rows while keeping the localized label", () => {
    mocked.permissions = { child: [{ id: "p", sessionID: "child" }] }
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Approval needed")
    const ordered = collect(
      tree,
      (node) => node.type === "text" && (text(node) === "!" || text(node) === "Parent session"),
    )
    expect(ordered.map((node) => text(node))).toEqual(["!", "Parent session", "!"])
  })

  test("distinguishes retry from plain working on the first row", () => {
    mocked.statuses = { child: { type: "retry" } }
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(text(tree)).toContain("Retrying")
    expect(glyphs(tree).map((node) => text(node))).toEqual(["~", "~"])
  })

  test("rows without live signals render no symbol and keep the full title width", () => {
    mocked.statuses = {}
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(glyphs(tree)).toEqual([])
    expect(text(tree)).toContain("Parent session")
  })

  test("a disconnected rail suppresses first-row symbols", () => {
    mocked.connected = false
    const tree = mount(() => SessionNavigation(navigationProps()))
    expect(glyphs(tree)).toEqual([])
  })

  test("long titles still truncate inside the 24-column rail with a symbol", () => {
    // A fresh id avoids the mocked slot reservation, isolating the symbol's
    // single cell: innerWidth 22 - 4 fixed - 1 symbol = 17 cells (14 + "...").
    mocked.sessions = [
      {
        id: "long",
        title: "Extremely long session title that cannot fit",
        directory: "/workspace",
        time: { updated: 2 },
      },
      { id: "idle", title: "Earlier session", directory: "/workspace", time: { updated: 1 } },
    ]
    mocked.statuses = { long: { type: "busy" } }
    const tree = mount(() => SessionNavigation(navigationProps()))
    const title = collect(tree, (node) => node.type === "text" && text(node).startsWith("Extremely long"))[0]
    expect(title).toBeDefined()
    expect(text(title)).toBe("Extremely long...")
    expect(glyphs(tree).map((node) => text(node))).toEqual(["*", "*"])
  })

  test("the goal planner pixel keeps its cell beside the working symbol", () => {
    mocked.sessions = [
      ...mocked.sessions,
      {
        id: "planner",
        title: "Goal plan writer",
        parentID: "root",
        directory: "/workspace",
        time: { updated: 5 },
      },
    ]
    mocked.statuses = { child: { type: "busy" }, planner: { type: "busy" } }
    const tree = mount(() => SessionNavigation({ ...navigationProps(new Set(["root"])), width: 36 }))
    const ordered = collect(
      tree,
      (node) =>
        node.type === Spinner || (node.type === "text" && (text(node) === "Goal plan writer" || text(node) === "*")),
    )
    // Rows: root (*,*), child (*,*), planner (title-row *, pixel, title,
    // label-row *) — first-row symbols stay left of the animated pixel.
    expect(ordered.map((node) => (node.type === Spinner ? "pixel" : text(node)))).toEqual([
      "*",
      "*",
      "*",
      "*",
      "*",
      "pixel",
      "Goal plan writer",
      "*",
    ])
  })
})
