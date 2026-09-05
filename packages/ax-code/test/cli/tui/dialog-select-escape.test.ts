import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"
import { KeyEvent, parseKeypress } from "@ax-code/tui"
import { DialogProvider, type DialogContext } from "../../../src/cli/cmd/tui/ui/dialog"
import { DialogSelect, type DialogSelectRef } from "../../../src/cli/cmd/tui/ui/dialog-select"

const mocked = vi.hoisted(() => ({
  dialog: undefined as DialogContext | undefined,
  handlers: [] as ((event: KeyEvent) => void)[],
  selectedText: "",
}))

vi.mock("@ax-code/tui/solid", async () => {
  const { onCleanup } = await import("solid-js")
  return {
    useKeyboard: (handler: (event: KeyEvent) => void) => {
      mocked.handlers.push(handler)
      onCleanup(() => {
        mocked.handlers = mocked.handlers.filter((item) => item !== handler)
      })
    },
    useRenderer: () => ({
      getSelection: () => ({ getSelectedText: () => mocked.selectedText }),
      root: { getChildren: () => [] },
    }),
    useTerminalDimensions: () => () => ({ width: 100, height: 30 }),
  }
})
vi.mock("@tui/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/cmd/tui/ui/dialog")>()),
  useDialog: () => mocked.dialog,
}))
vi.mock("@tui/context/theme", () => ({
  useTheme: () => ({ theme: {} }),
  selectedForeground: () => undefined,
}))
vi.mock("@tui/context/keybind", () => ({ useKeybind: () => ({}) }))
vi.mock("@tui/ui/toast", () => ({ useToast: () => ({ show: vi.fn() }) }))

type Element = { type: unknown; props: Record<string, unknown> }
const disposals: (() => void)[] = []

beforeEach(() => {
  mocked.handlers = []
  mocked.selectedText = ""
  // Capture classic JSX from the namespace-safe test transform. The real
  // dialog components and store run; only terminal nodes are replaced.
  vi.stubGlobal("React", {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
    Fragment: Symbol("Fragment"),
  })
  createRoot((dispose) => {
    disposals.push(dispose)
    const tree = DialogProvider({}) as unknown as Element
    mocked.dialog = tree.props.value as DialogContext
  })
})

afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  mocked.dialog = undefined
  vi.unstubAllGlobals()
})

function findElement(value: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(value)) return value.map((item) => findElement(item, predicate)).find(Boolean)
  if (!value || typeof value !== "object" || !("props" in value)) return undefined
  const element = value as Element
  return predicate(element) ? element : findElement(element.props.children, predicate)
}

function mountSelect(query = "model") {
  const dialog = mocked.dialog!
  const onClose = vi.fn()
  const onFilter = vi.fn()
  dialog.replace(() => undefined, onClose)
  return createRoot((dispose) => {
    disposals.push(dispose)
    let ref!: DialogSelectRef<string>
    const tree = DialogSelect({
      title: "Select a model",
      options: [{ title: "Example model", value: "model" }],
      onFilter,
      ref: (value) => (ref = value),
    })
    const inputElement = findElement(tree, (element) => element.type === "input")!
    const escapeHint = findElement(
      tree,
      (element) => element.type === "text" && typeof element.props.onMouseUp === "function",
    )!
    const onInput = inputElement.props.onInput as (value: string) => void
    let value = ""
    const input = {
      isDestroyed: false,
      focus: vi.fn(),
      get value() {
        return value
      },
      set value(next: string) {
        if (value === next) return
        value = next
        // InputRenderable.value emits INPUT synchronously in production.
        onInput(next)
      },
    }
    ;(inputElement.props.ref as (input: unknown) => void)(input)
    input.value = query
    onFilter.mockClear()
    return { dialog, input, ref, onClose, onFilter, dispose, clickEscapeHint: escapeHint.props.onMouseUp as () => void }
  })
}

function press(sequence: string) {
  const key = parseKeypress(sequence, { useKittyKeyboard: true })
  if (!key) throw new Error("Fixture key could not be parsed")
  const event = new KeyEvent(key)
  // Keep provider-first registration order: dismissal must consult the
  // active dialog before its later-mounted global key handler gets a turn.
  for (const handler of [...mocked.handlers]) {
    handler(event)
    if (event.propagationStopped) break
  }
  return event
}

describe("dialog select Escape", () => {
  test("clears the query first and closes only on the second Escape", () => {
    const { dialog, input, ref, onClose, onFilter } = mountSelect()

    const first = press("\u001b")

    expect(input.value).toBe("")
    expect(ref.filter).toBe("")
    expect(onFilter).toHaveBeenCalledExactlyOnceWith("")
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog.stack).toHaveLength(1)
    expect(first.defaultPrevented).toBe(true)
    expect(first.propagationStopped).toBe(true)

    press("\u001b")

    expect(dialog.stack).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  test("supports Kitty-encoded Escape", () => {
    const { input, dialog } = mountSelect()
    press("\u001b[27u")
    expect(input.value).toBe("")
    expect(dialog.stack).toHaveLength(1)
  })

  test("clicking the Escape hint uses the same two-stage behavior", () => {
    const { input, dialog, onFilter, onClose, clickEscapeHint } = mountSelect()
    clickEscapeHint()
    expect(input.value).toBe("")
    expect(onFilter).toHaveBeenCalledExactlyOnceWith("")
    expect(dialog.stack).toHaveLength(1)
    clickEscapeHint()
    expect(dialog.stack).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  test("closes immediately when the query is empty", () => {
    const { dialog, onClose } = mountSelect("")
    press("\u001b")
    expect(dialog.stack).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  test("keeps Ctrl+C as immediate dismissal even with a query", () => {
    const { dialog, onClose, onFilter } = mountSelect()
    press("\u0003")
    expect(dialog.stack).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onFilter).not.toHaveBeenCalled()
  })

  test("leaves text-selection Escape handling ahead of search clearing", () => {
    const { dialog, input, onClose } = mountSelect()
    mocked.selectedText = "Selected terminal text"
    press("\u001b")
    expect(input.value).toBe("model")
    expect(dialog.stack).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  test("disposing an old picker does not remove its replacement's handler", () => {
    const first = mountSelect("first")
    const second = mountSelect("second")
    first.dispose()
    press("\u001b")
    expect(second.input.value).toBe("")
    expect(second.dialog.stack).toHaveLength(1)
    expect(second.onClose).not.toHaveBeenCalled()
  })

  test("does not let a replaced picker consume another dialog's Escape", () => {
    const first = mountSelect()
    const onClose = vi.fn()
    first.dialog.replace(() => undefined, onClose)
    press("\u001b")
    expect(first.input.value).toBe("model")
    expect(first.dialog.stack).toHaveLength(0)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
