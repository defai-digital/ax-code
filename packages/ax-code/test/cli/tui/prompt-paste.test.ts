import { afterEach, describe, expect, test, vi } from "vitest"
import { createStore } from "solid-js/store"
import { PasteEvent } from "@ax-code/tui"
import { Filesystem } from "../../../src/util/filesystem"
import { Clipboard } from "../../../src/cli/cmd/tui/util/clipboard"
import { createPromptPaste, type PromptPasteHost } from "../../../src/cli/cmd/tui/component/prompt/prompt-paste"
import type { PromptInfo } from "../../../src/cli/cmd/tui/component/prompt/prompt-info"

afterEach(() => vi.restoreAllMocks())

function setup() {
  const [store, setStore] = createStore<{ prompt: PromptInfo; extmarkToPartIndex: Map<number, number> }>({
    prompt: { input: "", parts: [] },
    extmarkToPartIndex: new Map(),
  })
  const host: PromptPasteHost = {
    input: {
      visualCursor: { offset: 0 },
      insertText: vi.fn(),
      extmarks: { create: vi.fn(() => 1) },
    },
    store,
    setStore,
    pasteStyleId: 1,
    promptPartTypeId: () => 1,
    inputBlocked: () => false,
    disablePasteSummary: () => false,
    suppressAutocompleteForNextContentChange: vi.fn(),
    requestInputLayoutRefresh: vi.fn(),
    pasteSubmitGate: { beginPasteHandling: vi.fn(), finishPasteHandling: vi.fn() },
    log: { warn: vi.fn() },
    toast: { show: vi.fn() },
  }
  return {
    host,
    store,
    paste: (text: string) => createPromptPaste(host).handleTerminalPaste(new PasteEvent(Buffer.from(text))),
  }
}

describe("prompt terminal paste", () => {
  test("preserves indentation and blank lines when summarizing pasted code", async () => {
    const { paste, store, host } = setup()
    const text = "\n    first()\r\n    second()\r\n    third()\r\n\r\n"
    const normalized = "\n    first()\n    second()\n    third()\n\n"

    await paste(text)

    expect(store.prompt.parts).toEqual([expect.objectContaining({ type: "text", text: normalized })])
    expect(host.input.insertText).toHaveBeenCalledWith("[Pasted ~6 lines] ")
  })

  test.each(["   ", "\t", "\r\n"])("preserves a nonempty whitespace paste: %j", async (text) => {
    const read = vi.spyOn(Clipboard, "read").mockResolvedValue(undefined)
    const { paste, host } = setup()

    await paste(text)

    expect(host.input.insertText).toHaveBeenCalledWith(text.replace(/\r\n/g, "\n"))
    expect(read).not.toHaveBeenCalled()
  })

  test("keeps the empty paste clipboard-image fallback", async () => {
    const read = vi.spyOn(Clipboard, "read").mockResolvedValue(undefined)
    const { paste, host } = setup()

    await paste("")

    expect(read).toHaveBeenCalledOnce()
    expect(host.input.insertText).not.toHaveBeenCalled()
    expect(host.pasteSubmitGate.finishPasteHandling).toHaveBeenCalledWith({ submitDeferred: false })
  })

  test("falls back to text once when an SVG file cannot be read", async () => {
    vi.spyOn(Filesystem, "readText").mockRejectedValue(new Error("SVG is unavailable"))
    const readImage = vi.spyOn(Filesystem, "readArrayBuffer").mockRejectedValue(new Error("SVG is unavailable"))
    const { paste, host } = setup()

    await paste("/test/missing.svg")

    expect(host.input.insertText).toHaveBeenCalledWith("/test/missing.svg")
    expect(host.toast.show).toHaveBeenCalledTimes(1)
    expect(readImage).not.toHaveBeenCalled()
  })

  test("preserves a readable SVG as source text", async () => {
    const content = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    vi.spyOn(Filesystem, "readText").mockResolvedValue(content)
    const { paste, store } = setup()

    await paste("/test/icon.svg")

    expect(store.prompt.parts).toEqual([expect.objectContaining({ type: "text", text: content })])
  })
})
