import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, For, Show } from "solid-js"
import { SessionTopBar } from "../../../src/cli/tui/routes/session/top-bar"

const mocked = vi.hoisted(() => ({
  trigger: vi.fn(),
  copy: vi.fn(async (_text: string) => {}),
  toast: vi.fn(),
  providers: [
    { id: "anthropic", name: "Anthropic (Claude Code)" },
    { id: "codex", name: "OpenAI (Codex CLI)" },
  ],
  config: {} as { disabled_providers?: string[] },
  statuses: {} as Record<string, { type: string }>,
}))

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})

vi.mock("@tui/context/sync", () => ({
  useSync: () => ({
    data: {
      get provider() {
        return mocked.providers
      },
      get config() {
        return mocked.config
      },
      get session_status() {
        return mocked.statuses
      },
    },
    session: {
      get: (id: string) =>
        id === "root"
          ? { id: "root", title: "Rebrand this project", directory: "/workspace", time: { updated: 1 } }
          : undefined,
    },
  }),
}))
vi.mock("../../../src/cli/tui/context/theme", () => ({
  useTheme: () => ({ theme: { accent: "accent-color", warning: "warning-color", textMuted: "muted-color" } }),
}))
vi.mock("../../../src/cli/tui/ui/toast", () => ({ useToast: () => ({ show: mocked.toast }) }))
vi.mock("../../../src/cli/tui/util/clipboard", () => ({ Clipboard: { copy: mocked.copy } }))
vi.mock("../../../src/cli/tui/component/dialog-command", () => ({
  useCommandDialog: () => ({ trigger: mocked.trigger }),
}))

type Element = { type: unknown; props: Record<string, unknown> }
const disposals: (() => void)[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocked.providers = [
    { id: "anthropic", name: "Anthropic (Claude Code)" },
    { id: "codex", name: "OpenAI (Codex CLI)" },
  ]
  mocked.config = {}
  mocked.statuses = {}
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
  if (node.type === Show) {
    const when = node.props.when
    if (!when) return resolve(node.props.fallback)
    const children = node.props.children
    // Non-keyed Show hands its function child an accessor for the when value.
    return resolve(typeof children === "function" ? children(() => when) : children)
  }
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
  ;(node!.props.onMouseUp as (event: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() })
}

function bar(props: { width?: number; showTitle?: boolean } = {}) {
  return mount(() =>
    SessionTopBar({
      sessionID: "root",
      width: props.width ?? 120,
      showTitle: props.showTitle ?? true,
      statusTick: () => 0,
    }),
  )
}

describe("session top bar callbacks", () => {
  test("renders the title, session id, and one providers entry", () => {
    const tree = bar()
    expect(text(tree)).toContain("root")
    expect(text(tree)).toContain("Rebrand this project")
    expect(text(tree)).toContain("Providers (2)")
    expect(text(tree)).not.toContain("manage")
  })

  test("opens the provider manager from the providers entry", () => {
    const tree = bar()
    click(tree, "Providers (2)")
    expect(mocked.trigger).toHaveBeenCalledWith("provider.manage")
    expect(mocked.trigger).toHaveBeenCalledTimes(1)
  })

  test("copies the session id on click and confirms with a toast", async () => {
    const tree = bar()
    click(tree, "root")
    await vi.waitFor(() => expect(mocked.copy).toHaveBeenCalledExactlyOnceWith("root"))
    expect(mocked.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "Session ID copied to clipboard", variant: "success" }),
    )
  })

  test("shows the live status label while the session is busy", () => {
    mocked.statuses = { root: { type: "busy" } }
    const tree = bar()
    expect(text(tree)).toContain("Thinking")
    const status = find(tree, (item) => item.type === "text" && text(item) === "Thinking")
    expect(status?.props.fg).toBe("accent-color")
    expect(status?.props.fg).not.toBe("warning-color")
  })

  test("omits the title when the route header already shows it", () => {
    const tree = bar({ showTitle: false })
    expect(text(tree)).not.toContain("Rebrand this project")
    expect(text(tree)).toContain("root")
  })

  test("hides the providers entry when no provider is connected or disabled", () => {
    mocked.providers = []
    const tree = bar()
    expect(text(tree)).not.toContain("Providers")
  })

  test("keeps the providers entry when every provider is disabled", () => {
    mocked.providers = []
    mocked.config = { disabled_providers: ["openai"] }
    const tree = bar()
    expect(text(tree)).toContain("Providers (0)")
    click(tree, "Providers (0)")
    expect(mocked.trigger).toHaveBeenCalledWith("provider.manage")
  })

  test("keeps one provider action under extreme narrowness", () => {
    const tree = bar({ width: 28 })
    expect(text(tree)).toContain("Providers (2)")
    expect(text(tree)).not.toContain("manage")
  })
})
