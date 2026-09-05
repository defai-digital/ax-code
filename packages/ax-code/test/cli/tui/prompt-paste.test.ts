import { afterEach, describe, expect, test, vi } from "vitest"
import { createStore } from "solid-js/store"
import { PasteEvent } from "ax-tui"
import { Filesystem } from "../../../src/util/filesystem"
import { Clipboard } from "../../../src/cli/cmd/tui/util/clipboard"
import { createPromptPaste, type PromptPasteHost } from "../../../src/cli/cmd/tui/component/prompt/prompt-paste"
import type { PromptInfo } from "../../../src/cli/cmd/tui/component/prompt/prompt-info"
import { createPromptPasteSubmitGate } from "../../../src/cli/cmd/tui/component/prompt/view-model"

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
  const controller = createPromptPaste(host)
  return {
    host,
    store,
    controller,
    paste: (text: string) => controller.handleTerminalPaste(new PasteEvent(Buffer.from(text))),
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

  test("does not paste a clipboard image after the composer is destroyed", async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof Clipboard.read>>>()
    vi.spyOn(Clipboard, "read").mockReturnValue(pending.promise)
    const { paste, host, store } = setup()
    const running = paste("")
    Object.assign(host.input, { isDestroyed: true })
    pending.resolve({ mime: "image/png", data: "dGVzdA==" })
    await running

    expect(host.input.insertText).not.toHaveBeenCalled()
    expect(host.input.extmarks.create).not.toHaveBeenCalled()
    expect(store.prompt.parts).toEqual([])
    expect(host.pasteSubmitGate.finishPasteHandling).toHaveBeenCalledWith({ submitDeferred: false })
  })

  test("does not insert a file after input becomes blocked during the read", async () => {
    const pending = Promise.withResolvers<string>()
    vi.spyOn(Filesystem, "readText").mockReturnValue(pending.promise)
    const { paste, host } = setup()
    const running = paste("/test/icon.svg")
    host.inputBlocked = () => true
    pending.resolve("<svg></svg>")
    await running

    expect(host.input.insertText).not.toHaveBeenCalled()
  })

  test("does not show a stale read error or insert fallback text after destruction", async () => {
    const pending = Promise.withResolvers<string>()
    vi.spyOn(Filesystem, "readText").mockReturnValue(pending.promise)
    const { paste, host } = setup()
    const running = paste("/test/icon.svg")
    Object.assign(host.input, { isDestroyed: true })
    pending.reject(new Error("File read failed"))
    await running

    expect(host.toast.show).not.toHaveBeenCalled()
    expect(host.input.insertText).not.toHaveBeenCalled()
  })

  test("discards deferred submission when a pending file paste is disposed", async () => {
    const pending = Promise.withResolvers<string>()
    vi.spyOn(Filesystem, "readText").mockReturnValue(pending.promise)
    const { paste, controller, host } = setup()
    const submit = vi.fn()
    const gate = createPromptPasteSubmitGate({ submit })
    host.pasteSubmitGate = gate
    const running = paste("/test/icon.svg")
    expect(gate.deferSubmitUntilPasteHandled()).toBe(true)
    controller.dispose()
    pending.resolve("<svg></svg>")
    await running

    expect(host.input.insertText).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  test("does not read the clipboard or insert direct content after disposal", async () => {
    const read = vi.spyOn(Clipboard, "read").mockResolvedValue({ mime: "image/png", data: "dGVzdA==" })
    const { controller, host } = setup()
    controller.dispose()

    expect(controller.canPaste()).toBe(false)
    expect(await controller.pasteClipboardImage()).toBe(false)
    expect(await controller.pasteImage({ mime: "image/png", content: "dGVzdA==" })).toBe(false)
    controller.pasteText("text", "summary")
    expect(read).not.toHaveBeenCalled()
    expect(host.input.insertText).not.toHaveBeenCalled()
  })

  test("does not insert a binary image after disposal", async () => {
    const pending = Promise.withResolvers<ArrayBuffer>()
    vi.spyOn(Filesystem, "readArrayBuffer").mockReturnValue(pending.promise)
    const { paste, controller, host } = setup()
    const running = paste("/test/image.png")
    controller.dispose()
    pending.resolve(new ArrayBuffer(4))
    await running

    expect(host.input.insertText).not.toHaveBeenCalled()
    expect(host.toast.show).not.toHaveBeenCalled()
  })

  test("does not insert Windows clipboard text after disposal", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof Clipboard.read>>>()
      vi.spyOn(Clipboard, "read").mockReturnValue(pending.promise)
      const { controller, host } = setup()
      const running = controller.pasteWindowsClipboardText()
      controller.dispose()
      pending.resolve({ mime: "text/plain", data: "clipboard text" })

      expect(await running).toBe(false)
      expect(host.input.insertText).not.toHaveBeenCalled()
      expect(host.pasteSubmitGate.finishPasteHandling).toHaveBeenCalledWith({ submitDeferred: false })
    } finally {
      Object.defineProperty(process, "platform", platform)
    }
  })
})
