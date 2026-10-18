import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
import * as axTui from "ax-tui"
import type { BoxRenderable, KeyEvent, TextareaRenderable } from "ax-tui"
import { Autocomplete, type AutocompleteRef } from "../../../src/cli/tui/component/prompt/autocomplete"
import { Locale } from "../../../src/util/locale"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
vi.mock("solid-js/store", async () => {
  const { createRequire } = await import("node:module")
  const require = createRequire(import.meta.url)
  require("solid-js/dist/solid.cjs")
  // The CJS store must share the client runtime used by the component's memos.
  const runtimePath = require.resolve("solid-js")
  const previous = require.cache[runtimePath]
  require.cache[runtimePath] = require.cache[require.resolve("solid-js/dist/solid.cjs")]
  try {
    return require("solid-js/store/dist/store.cjs") as typeof import("solid-js/store")
  } finally {
    if (previous) require.cache[runtimePath] = previous
    else delete require.cache[runtimePath]
  }
})
const mocked = vi.hoisted(() => ({
  dimensions: () => ({ width: 120, height: 40 }),
  files: async () => ({ data: [] as string[] }),
  agents: [] as { name: string; tier?: string }[],
  editor: { text: "", cursor: 0 },
}))
vi.mock("ax-tui/solid", () => ({ useTerminalDimensions: () => () => mocked.dimensions() }))
vi.mock("ax-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ax-tui")>()
  return {
    ...actual,
    getEditorAutocompleteRequest: () => ({ text: mocked.editor.text, cursor: mocked.editor.cursor }),
    applyEditorAutocomplete: vi.fn(() => true),
  }
})
vi.mock("@tui/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock("@tui/context/theme", () => ({ useTheme: () => ({ theme: {} }) }))
vi.mock("@tui/context/kv", () => ({ useKV: () => ({ get: () => false }) }))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({ client: { find: { files: (...args: Parameters<typeof mocked.files>) => mocked.files(...args) } } }),
}))
vi.mock("@tui/context/sync", () => ({
  useSync: () => ({
    get data() {
      return { agent: mocked.agents, command: [], mcp_resource: {}, path: { directory: "/project" } }
    },
  }),
}))
vi.mock("@tui/component/dialog-command", () => ({
  useCommandDialog: () => ({ slashes: () => [], keybinds: () => {} }),
}))
vi.mock("../../../src/cli/tui/component/prompt/frecency", () => ({
  useFrecency: () => ({ getFrecency: () => 0, updateFrecency: () => {} }),
}))

const disposals: (() => void)[] = []
beforeEach(() => {
  // Run the component's real client memos and lifecycle without terminal layout.
  vi.stubGlobal("React", { createElement: () => undefined })
  vi.spyOn(Locale, "truncateMiddle")
  mocked.files = async () => ({ data: [] })
  mocked.agents = []
  mocked.editor = { text: "", cursor: 0 }
  vi.mocked(axTui.applyEditorAutocomplete).mockClear()
})
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(options: { nativeEditor?: boolean } = {}) {
  let anchor: BoxRenderable
  let ref: AutocompleteRef
  let buffer = ""
  let cursor = 1
  const input = {
    get cursorOffset() {
      return cursor
    },
    set cursorOffset(value: number) {
      cursor = value
    },
    get logicalCursor() {
      return { row: 0, col: cursor }
    },
    getTextRange: (start: number, end: number) => buffer.slice(start, end),
    deleteRange: vi.fn(),
    insertText: vi.fn(),
    extmarks: { create: vi.fn(() => 1) },
  }
  if (options.nativeEditor) Object.setPrototypeOf(input, axTui.TextareaRenderable.prototype)
  const readAnchor = vi.fn(() => anchor)
  const [dimensions, setDimensions] = createSignal({ width: 120, height: 40 })
  const [value, setValue] = createSignal("")
  mocked.dimensions = dimensions
  createRoot((dispose) => {
    disposals.push(dispose)
    Autocomplete({
      get value() {
        return value()
      },
      anchor: readAnchor,
      input: () => input as unknown as TextareaRenderable,
      ref: (created) => (ref = created),
      setPrompt: () => {},
      clearPrompt: () => {},
      setExtmark: () => {},
      fileStyleId: 0,
      agentStyleId: 0,
      promptPartTypeId: () => 0,
    })
  })
  return {
    readAnchor,
    input,
    ref: () => ref,
    attachAnchor: () => {
      anchor = { x: 0, y: 20, width: 80, height: 3 } as BoxRenderable
    },
    type: (text: string, cursorOffset = text.length) => {
      buffer = text
      mocked.editor = { text, cursor: cursorOffset }
      input.cursorOffset = cursorOffset
      setValue(text)
      ref.onInput(text)
    },
    move: (name: "up" | "down") => ref.onKeyDown({ name, preventDefault: vi.fn() } as unknown as KeyEvent),
    resize: () => {
      anchor.width = 40
      setDimensions({ width: 60, height: 40 })
    },
  }
}

describe("autocomplete anchor lifecycle", () => {
  test("mounts before the parent assigns its anchor and offers references after opening", () => {
    const fixture = mount()
    expect(fixture.readAnchor).not.toHaveBeenCalled()
    fixture.attachAnchor()
    fixture.ref().onInput("@")
    expect(fixture.ref().visible).toBe("@")
    fixture.move("up")
    fixture.move("down")
    expect(Locale.truncateMiddle).toHaveBeenCalledWith("@diff", 76)
    expect(Locale.truncateMiddle).toHaveBeenCalledWith("@file:…:start-end", 76)
    fixture.ref().onKeyDown({ name: "return", preventDefault: vi.fn() } as unknown as KeyEvent)
    expect(fixture.input.insertText).toHaveBeenCalledWith("@diff ")
    expect(fixture.ref().visible).toBe(false)
  })

  test("refreshes reference label widths when the terminal resizes", () => {
    const fixture = mount()
    fixture.attachAnchor()
    fixture.ref().onInput("@")
    vi.mocked(Locale.truncateMiddle).mockClear()
    fixture.resize()
    fixture.move("down")
    expect(Locale.truncateMiddle).toHaveBeenCalledWith("@file:…:start-end", 36)
  })

  test("does not build reference options while slash autocomplete is open", () => {
    const fixture = mount()
    fixture.attachAnchor()
    fixture.ref().onInput("/")
    expect(fixture.ref().visible).toBe("/")
    expect(Locale.truncateMiddle).not.toHaveBeenCalled()
  })

  test("replaces only the reference token when @ is triggered mid-prompt", () => {
    const fixture = mount()
    fixture.attachAnchor()
    fixture.type("see @dif", 8)
    expect(fixture.ref().visible).toBe("@")
    fixture.ref().onKeyDown({ name: "return", preventDefault: vi.fn() } as unknown as KeyEvent)
    expect(fixture.input.deleteRange).toHaveBeenCalledWith(0, 4, 0, 8)
    expect(fixture.input.insertText).toHaveBeenCalledWith("@diff ")
    expect(fixture.input.cursorOffset).toBe(10)
  })

  test("loads files when @ opens with an empty query", async () => {
    const fixture = mount()
    fixture.attachAnchor()
    mocked.files = async () => ({ data: ["src/index.ts"] })
    fixture.type("@", 1)
    await vi.waitFor(() => expect(Locale.truncateMiddle).toHaveBeenCalledWith("src/index.ts", 76))
  })

  test("resets selection when asynchronous file results replace a longer list", async () => {
    mocked.files = async () => ({ data: ["src/one.ts", "src/two.ts", "src/three.ts"] })
    const fixture = mount({ nativeEditor: true })
    fixture.attachAnchor()
    fixture.type("@src")
    await vi.waitFor(() => expect(Locale.truncateMiddle).toHaveBeenCalledWith("src/three.ts", 76))
    const pending = Promise.withResolvers<{ data: string[] }>()
    mocked.files = () => pending.promise
    fixture.type("@src/")
    fixture.move("down")
    fixture.move("down")
    pending.resolve({ data: ["src/fresh.ts"] })
    await vi.waitFor(() => expect(Locale.truncateMiddle).toHaveBeenCalledWith("src/fresh.ts", 76))
    fixture.ref().onKeyDown({ name: "return", preventDefault: vi.fn() } as unknown as KeyEvent)
    expect(axTui.applyEditorAutocomplete).toHaveBeenCalledTimes(1)
  })

  test("uses display offsets when checking the character after the cursor", () => {
    mocked.agents = [{ name: "helper", tier: "subagent" }]
    const fixture = mount()
    fixture.attachAnchor()
    fixture.type("字 @ x", 4)
    expect(fixture.ref().visible).toBe("@")
    fixture.ref().onKeyDown({ name: "return", preventDefault: vi.fn() } as unknown as KeyEvent)
    expect(fixture.input.insertText).toHaveBeenCalledWith("@helper")
  })

  test("uses the native completion adapter when the editor is a TextareaRenderable", async () => {
    mocked.files = async () => ({ data: ["src/index.ts"] })
    const fixture = mount({ nativeEditor: true })
    fixture.attachAnchor()
    fixture.type("@", 1)
    await vi.waitFor(() => expect(Locale.truncateMiddle).toHaveBeenCalledWith("src/index.ts", 76))
    fixture.ref().onKeyDown({ name: "return", preventDefault: vi.fn() } as unknown as KeyEvent)
    expect(axTui.applyEditorAutocomplete).toHaveBeenCalledTimes(1)
    expect(fixture.input.deleteRange).not.toHaveBeenCalled()
    expect(fixture.input.insertText).not.toHaveBeenCalled()
  })
})
