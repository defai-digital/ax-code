import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
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
const mocked = vi.hoisted(() => ({ dimensions: () => ({ width: 120, height: 40 }) }))
vi.mock("ax-tui/solid", () => ({ useTerminalDimensions: () => () => mocked.dimensions() }))
vi.mock("@tui/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock("@tui/context/theme", () => ({ useTheme: () => ({ theme: {} }) }))
vi.mock("@tui/context/kv", () => ({ useKV: () => ({ get: () => false }) }))
vi.mock("@tui/context/sdk", () => ({
  useSDK: () => ({ client: { find: { files: async () => ({ data: [] }) } } }),
}))
vi.mock("@tui/context/sync", () => ({
  useSync: () => ({ data: { agent: [], command: [], mcp_resource: {}, path: { directory: "/project" } } }),
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
})
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount() {
  let anchor: BoxRenderable
  let ref: AutocompleteRef
  const input = {
    cursorOffset: 1,
    logicalCursor: { row: 0, col: 1 },
    getTextRange: () => "",
    deleteRange: vi.fn(),
    insertText: vi.fn(),
  }
  const readAnchor = vi.fn(() => anchor)
  const [dimensions, setDimensions] = createSignal({ width: 120, height: 40 })
  mocked.dimensions = dimensions
  createRoot((dispose) => {
    disposals.push(dispose)
    Autocomplete({
      value: "",
      anchor: readAnchor,
      input: () => input as unknown as TextareaRenderable,
      ref: (value) => (ref = value),
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
})
